# PowerShell5-compatible bootstrap for an ephemeral GitLab Windows runner.
param([ValidateSet('native','wsl')][string]$Mode='native')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$privateRoot=$null; $ownedProcess=$null
$resultRoot=Join-Path (Get-Location) 'qualification'
[void][System.IO.Directory]::CreateDirectory($resultRoot)
$bootstrap=[ordered]@{schema_version=1; scope='credential_free_windows_ci'; status='failed'; reason='bootstrap_failed'; mode=$Mode; node='22.12.0'; powershell='7.4.6'; actual_model_calls=0; op_calls=0; cleanup=$false}
try {
  if ($env:OS -ne 'Windows_NT' -or $env:CI_SERVER_HOST -ne 'gitlab.com') { throw 'hosted_gitlab_windows_required' }
  if (Test-Path -LiteralPath 'judge-access/temporary-credentials.json') { throw 'submission_credentials_must_not_enter_ci' }
  $privateRoot=Join-Path ([System.IO.Path]::GetTempPath()) ('a2-ci-tools-'+[guid]::NewGuid().ToString('N'))
  [void][System.IO.Directory]::CreateDirectory($privateRoot)
  $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=Get-Acl -LiteralPath $privateRoot; $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid)
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  Set-Acl -LiteralPath $privateRoot -AclObject $acl
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $packages=@(
    @{url='https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip'; file='node.zip'; sha='2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8'; folder='node'},
    @{url='https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/PowerShell-7.4.6-win-x64.zip'; file='pwsh.zip'; sha='ed49ce5adb2162cc4a835d740486be729ba904627cca71fcb6c2b95be11b993d'; folder='pwsh'}
  )
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  foreach($package in $packages) {
    $archive=Join-Path $privateRoot $package.file
    Invoke-WebRequest -UseBasicParsing -Uri $package.url -OutFile $archive -TimeoutSec 90 | Out-Null
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $package.sha) { throw 'tool_checksum_mismatch' }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive,(Join-Path $privateRoot $package.folder))
  }
  $entry=if($Mode -eq 'native'){'windows-muse-probe.ps1'}else{'wsl-readiness.ps1'}
  $exe=Join-Path $privateRoot 'pwsh/pwsh.exe'
  $info=[System.Diagnostics.ProcessStartInfo]::new(); $info.FileName=$exe
  # Only fixed, repository-owned paths; no user input is interpolated into code.
  $script=Join-Path (Get-Location) ('scripts/ci/'+$entry)
  $info.Arguments='-NoLogo -NoProfile -File "'+$script+'"'
  $info.WorkingDirectory=(Get-Location).Path; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $info.EnvironmentVariables.Clear()
  foreach($name in @('SystemRoot','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','CI_SERVER_HOST','CI_PROJECT_PATH')){
    $value=[Environment]::GetEnvironmentVariable($name); if($value){$info.EnvironmentVariables[$name]=$value}
  }
  $info.EnvironmentVariables['PATH']=(Join-Path $privateRoot 'node/node-v22.12.0-win-x64')+';'+(Join-Path $env:SystemRoot 'System32')
  $ownedProcess=[System.Diagnostics.Process]::new(); $ownedProcess.StartInfo=$info
  if(!$ownedProcess.Start()){throw 'probe_start_failed'}
  $stdout=$ownedProcess.StandardOutput.ReadToEndAsync(); $stderr=$ownedProcess.StandardError.ReadToEndAsync()
  if(!$ownedProcess.WaitForExit(420000)){throw 'probe_timeout'}
  if(!$stdout.Wait(2000) -or !$stderr.Wait(2000)){throw 'probe_stream_cleanup_unconfirmed'}
  $text=$stdout.Result
  if($text.Length -gt 65536){throw 'probe_report_invalid'}
  $raw=$text | ConvertFrom-Json
  if($raw.schema_version -ne 1 -or @('passed','failed','unavailable') -notcontains $raw.status){throw 'probe_report_invalid'}
  $reasons=@('probe_failed','windows_powershell7_required','unsafe_home_assignment','architecture_unsupported','private_directory_unqualified','node_version_unqualified','windows_guard_unqualified','url_rejected','download_redirect_rejected','download_unavailable','download_too_large','manifest_unqualified','artifact_unqualified','process_start_failed','process_timeout','process_stream_timeout','process_output_limit','echo_exit_failed','echo_output_invalid','echo_event_unqualified','echo_usage_unqualified','echo_terminal_unqualified','owned_cleanup_unconfirmed','ephemeral_ci_required','wsl_start_failed','wsl_timeout','wsl_stream_unconfirmed','wsl_output_limit','wsl2_install_unavailable','wsl2_kernel_unqualified','wsl_echo_unqualified','wsl2_unavailable','wsl_cleanup_unconfirmed')
  $reason=if($null -eq $raw.reason){$null}elseif($reasons -contains $raw.reason){$raw.reason}else{'probe_failed'}
  $report=[ordered]@{schema_version=1;status=$raw.status;reason=$reason;actual_model_calls=0;op_calls=0;credential_values_supplied=$false}
  if($Mode -eq 'native'){
    if($raw.scope -cne 'windows_native_echo_only' -or $raw.provider -cne 'echo' -or $raw.credential_values_supplied -ne $false){throw 'probe_report_invalid'}
    $report.scope='windows_native_echo_only';$report.platform='windows';$report.provider='echo';$report.muse_version='1.4.14-R7309.1'
    foreach($field in @('manifest_verified','artifact_verified','guard_start','guard_install','echo_terminal_completed','owned_parents_and_files_cleanup_confirmed')){
      if($raw.$field -isnot [bool]){throw 'probe_report_invalid'};$report[$field]=$raw.$field
    }
    if($null -ne $raw.muse_sha256 -and ($raw.muse_sha256 -isnot [string] -or $raw.muse_sha256 -notmatch '^[a-f0-9]{64}$')){throw 'probe_report_invalid'};$report.muse_sha256=$raw.muse_sha256
    if($null -ne $raw.os_version -and ($raw.os_version -isnot [string] -or $raw.os_version -notmatch '^\d+(?:\.\d+){1,4}$')){throw 'probe_report_invalid'};$report.os_version=$raw.os_version
    if($null -ne $raw.architecture -and @('X64','Arm64') -notcontains $raw.architecture){throw 'probe_report_invalid'};$report.architecture=$raw.architecture
    if($null -ne $raw.node_version -and $raw.node_version -cne '22.12.0'){throw 'probe_report_invalid'};$report.node_version=$raw.node_version
    if($null -ne $raw.echo_usage_calls -and (($raw.echo_usage_calls -isnot [int] -and $raw.echo_usage_calls -isnot [long]) -or $raw.echo_usage_calls -lt 0 -or $raw.echo_usage_calls -gt 1)){throw 'probe_report_invalid'};$report.echo_usage_calls=$raw.echo_usage_calls
    $report.descendant_cleanup='not_independently_qualified';$report.windows_credential_store_access='not_observed'
    $report.limits=@('no_wsl','no_real_login','no_model_or_live_presence','native_windows_harness_unsupported')
  }else{
    if($raw.scope -cne 'hosted_wsl2_echo' -or $raw.credential_values_supplied -ne $false){throw 'probe_report_invalid'}
    $report.scope='hosted_wsl2_echo';$report.distribution='Ubuntu-24.04';$report.login='not_attempted'
    foreach($field in @('echo_completed','distribution_stopped')){if($raw.$field -isnot [bool]){throw 'probe_report_invalid'};$report[$field]=$raw.$field}
    if($null -ne $raw.kernel -and ($raw.kernel -isnot [string] -or $raw.kernel -notmatch '^[\w.+-]{1,128}$')){throw 'probe_report_invalid'};$report.kernel=$raw.kernel
    if($null -ne $raw.node_version -and $raw.node_version -cne '22.12.0'){throw 'probe_report_invalid'};$report.node_version=$raw.node_version
    if($null -ne $raw.muse_version -and $raw.muse_version -cne '1.4.14-R7309.1'){throw 'probe_report_invalid'};$report.muse_version=$raw.muse_version
    $report.limits=@('no_real_login','no_authenticated_model_request','no_full_coding_workflow')
  }
  $name=if($Mode -eq 'native'){'windows-native.json'}else{'wsl-readiness.json'}
  [System.IO.File]::WriteAllText((Join-Path $resultRoot $name),($report | ConvertTo-Json -Depth 8 -Compress))
  if($ownedProcess.ExitCode -ne 0 -or $report.status -ne 'passed'){throw 'probe_not_qualified'}
  $bootstrap.status='passed'; $bootstrap.reason=$null
} catch {
  $known=@('hosted_gitlab_windows_required','submission_credentials_must_not_enter_ci','tool_checksum_mismatch','probe_start_failed','probe_timeout','probe_stream_cleanup_unconfirmed','probe_report_invalid','probe_not_qualified')
  $bootstrap.reason=if($known -contains $_.Exception.Message){$_.Exception.Message}else{'bootstrap_failed'}
} finally {
  $clean=$true
  if($ownedProcess){
    try{if(!$ownedProcess.HasExited){
      # taskkill targets only the process this script created, never a name/port.
      & "$env:SystemRoot\System32\taskkill.exe" /PID $ownedProcess.Id /T /F 2>&1 | Out-Null
      if(!$ownedProcess.WaitForExit(5000)){$clean=$false}
    }}catch{$clean=$false}; $ownedProcess.Dispose()
  }
  if($privateRoot){try{Remove-Item -LiteralPath $privateRoot -Recurse -Force -ErrorAction Stop}catch{$clean=$false}}
  $bootstrap.cleanup=$clean
  if(!$clean){$bootstrap.status='failed';$bootstrap.reason='owned_cleanup_unconfirmed'}
  [System.IO.File]::WriteAllText((Join-Path $resultRoot 'bootstrap.json'),($bootstrap | ConvertTo-Json -Compress))
}
$bootstrap | ConvertTo-Json -Compress
if($bootstrap.status -ne 'passed'){exit 1}

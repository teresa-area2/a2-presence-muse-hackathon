# Windows CI diagnostic: public pinned binary and synthetic Echo only.
# Emits one allowlisted JSON object; never saves native output or credentials.
# This is not native-Windows harness support or a live Meta/Presence test.
param([string]$RepoRoot = (Join-Path $PSScriptRoot '../..'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$version = '1.4.14-R7309.1'
$manifestUrl = 'https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=1.4.14-R7309.1&file=manifest.json'
$pins = @{
  X64 = @{ key='x86_windows'; file='muse-x86-windows.exe'; size=435429624L; sha='20d18c426cc26e9e4b3cc07008ec07ec97e12e466a2be8cd2797b2e0e2018382' }
  Arm64 = @{ key='aarch64_windows'; file='muse-aarch64-windows.exe'; size=398733560L; sha='64cef76cb210de993d31478ee582ef4639bbb212df8912b74f45d40431e66e82' }
}
$report = [ordered]@{schema_version=1; scope='windows_native_echo_only'; status='failed'; reason='probe_failed'; platform='windows'; os_version=$null; powershell_major=$null; architecture=$null; node_version=$null; muse_version=$version; muse_sha256=$null; manifest_verified=$false; artifact_verified=$false; guard_start=$false; guard_install=$false; echo_terminal_completed=$false; echo_usage_calls=$null; provider='echo'; credential_values_supplied=$false; windows_credential_store_access='not_observed'; owned_parents_and_files_cleanup_confirmed=$false; descendant_cleanup='not_independently_qualified'; limits=@('no_wsl','no_real_login','no_model_or_live_presence','native_windows_harness_unsupported')}
$private = $null
$processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$http = $null

function Assert-OfficialUri([string]$raw) {
  $u = [System.Uri]$raw
  if ($u.Scheme -cne 'https' -or $u.Host -cne 'lookaside.facebook.com' -or !$u.IsDefaultPort -or $u.UserInfo -or $u.Fragment) { throw 'url_rejected' }
  return $u
}

function Receive-Official([string]$url, [string]$destination, [long]$maxBytes) {
  $u = Assert-OfficialUri $url
  $cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(180))
  try {
    for ($redirect = 0; $redirect -le 3; $redirect++) {
      $resp = $http.GetAsync($u, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cts.Token).GetAwaiter().GetResult()
      try {
        if ([int]$resp.StatusCode -ge 300 -and [int]$resp.StatusCode -lt 400) {
          if ($redirect -eq 3 -or $null -eq $resp.Headers.Location) { throw 'download_redirect_rejected' }
          $u = Assert-OfficialUri ([System.Uri]::new($u, $resp.Headers.Location).AbsoluteUri)
          continue
        }
        if (!$resp.IsSuccessStatusCode) { throw 'download_unavailable' }
        if ($null -ne $resp.Content.Headers.ContentLength -and $resp.Content.Headers.ContentLength -gt $maxBytes) { throw 'download_too_large' }
        $inputStream = $resp.Content.ReadAsStreamAsync($cts.Token).GetAwaiter().GetResult()
        $out = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
          $buffer = [byte[]]::new(65536); $total = 0L
          while (($n = $inputStream.ReadAsync($buffer,0,$buffer.Length,$cts.Token).GetAwaiter().GetResult()) -gt 0) {
            $total += $n; if ($total -gt $maxBytes) { throw 'download_too_large' }; $out.Write($buffer,0,$n)
          }
        } finally { $out.Dispose(); $inputStream.Dispose() }
        return
      } finally { $resp.Dispose() }
    }
  } finally { $cts.Dispose() }
  throw 'download_unavailable'
}

function Invoke-Owned([string]$exe, [string[]]$arguments, [string]$cwd, [int]$timeoutMs) {
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $exe; $info.WorkingDirectory = $cwd; $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.RedirectStandardInput = $true; $info.CreateNoWindow = $true
  foreach ($arg in $arguments) { [void]$info.ArgumentList.Add($arg) }
  $info.Environment.Clear()
  $info.Environment['SystemRoot'] = $env:SystemRoot; $info.Environment['WINDIR'] = $env:SystemRoot
  $info.Environment['PATH'] = [System.IO.Path]::GetDirectoryName($script:node) + ';' + [System.Environment]::GetFolderPath('System')
  $info.Environment['HOME'] = $script:probeHome; $info.Environment['USERPROFILE'] = $script:probeHome
  $info.Environment['APPDATA'] = $script:config; $info.Environment['LOCALAPPDATA'] = $script:local
  $info.Environment['XDG_CONFIG_HOME'] = $script:config; $info.Environment['XDG_CACHE_HOME'] = $script:cache; $info.Environment['XDG_DATA_HOME'] = $script:data
  $info.Environment['TEMP'] = $script:tmp; $info.Environment['TMP'] = $script:tmp; $info.Environment['MUSE_NO_AUTO_UPDATE'] = '1'
  $p = [System.Diagnostics.Process]::new(); $p.StartInfo = $info
  if (!$p.Start()) { throw 'process_start_failed' }; $script:processes.Add($p)
  $p.StandardInput.Close(); $outBuffer=[char[]]::new(4096); $errBuffer=[char[]]::new(4096)
  $outText=[System.Text.StringBuilder]::new(); $errText=[System.Text.StringBuilder]::new()
  $outTask=$p.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length); $errTask=$p.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length)
  $outDone=$false; $errDone=$false; $timer=[System.Diagnostics.Stopwatch]::StartNew()
  while (!$outDone -or !$errDone -or !$p.HasExited) {
    if ($timer.ElapsedMilliseconds -ge $timeoutMs) { try { if (!$p.HasExited) { $p.Kill($true) } } catch {}; [void]$p.WaitForExit(5000); throw 'process_timeout' }
    if (!$outDone -and $outTask.IsCompleted) {
      $n=$outTask.GetAwaiter().GetResult(); if (!$n) { $outDone=$true } else { [void]$outText.Append($outBuffer,0,$n); if ($outText.Length -gt 2097152) { throw 'process_output_limit' }; $outTask=$p.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length) }
    }
    if (!$errDone -and $errTask.IsCompleted) {
      $n=$errTask.GetAwaiter().GetResult(); if (!$n) { $errDone=$true } else { [void]$errText.Append($errBuffer,0,$n); if ($errText.Length -gt 2097152) { throw 'process_output_limit' }; $errTask=$p.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length) }
    }
    [System.Threading.Thread]::Sleep(10)
  }
  return @{exit=$p.ExitCode; stdout=$outText.ToString(); stderr=$errText.ToString()}
}

try {
  if (!$IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) { throw 'windows_powershell7_required' }
  # PowerShell variable names are case-insensitive: never overwrite its $HOME.
  if ([System.IO.File]::ReadAllText($PSCommandPath) -match '(?im)\$(?:(?:(?:script|global|local|private):)?(?:home|codex_home)|\{(?:(?:script|global|local|private):)?(?:home|codex_home)\})\s*(?:[+\-*/%]?=|\+\+|--)') { throw 'unsafe_home_assignment' }
  $report.os_version=[System.Environment]::OSVersion.Version.ToString(); $report.powershell_major=$PSVersionTable.PSVersion.Major
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString(); if (!$pins.ContainsKey($arch)) { throw 'architecture_unsupported' }
  $report.architecture = $arch; $pin = $pins[$arch]
  $script:node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $script:private = Join-Path ([System.IO.Path]::GetTempPath()) ('a2-windows-probe-' + [guid]::NewGuid().ToString('N'))
  [void][System.IO.Directory]::CreateDirectory($private)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $private; $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule); Set-Acl -LiteralPath $private -AclObject $acl
  $verifyAcl = Get-Acl -LiteralPath $private
  if (!$verifyAcl.AreAccessRulesProtected -or @($verifyAcl.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value }).Count -ne 0) { throw 'private_directory_unqualified' }
  $script:probeHome=Join-Path $private 'home'; $script:config=Join-Path $private 'config'; $script:local=Join-Path $private 'local'; $script:cache=Join-Path $private 'cache'; $script:data=Join-Path $private 'data'; $script:tmp=Join-Path $private 'tmp'
  foreach ($dir in @($probeHome,$config,$local,$cache,$data,$tmp)) { [void][System.IO.Directory]::CreateDirectory($dir) }
  $v = Invoke-Owned $node @('--version') $private 10000
  if ($v.exit -ne 0 -or $v.stdout.Trim() -cne 'v22.12.0') { throw 'node_version_unqualified' }; $report.node_version = '22.12.0'

  # Trap modules prove that each real launcher refuses before evaluating access,
  # installer or runtime modules. No real credentials or server are present.
  $fixture = Join-Path $private 'fixture'; [void][System.IO.Directory]::CreateDirectory((Join-Path $fixture 'scripts')); [void][System.IO.Directory]::CreateDirectory((Join-Path $fixture 'src'))
  foreach ($name in @('judge-start.mjs','judge-install.mjs')) { Copy-Item -LiteralPath (Join-Path $RepoRoot "scripts/$name") -Destination (Join-Path $fixture "scripts/$name") }
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'src/judge-platform.mjs') -Destination (Join-Path $fixture 'src/judge-platform.mjs')
  $marker = Join-Path $fixture 'unexpected-module-evaluation'
  $literal = ConvertTo-Json -Compress -InputObject $marker
  $trap = "import fs from 'node:fs';fs.writeFileSync($literal,'unexpected');throw Error('unexpected_import');"
  foreach ($name in @('src/judge-access.mjs','src/judge-install-runner.mjs','src/coding-task-profiles.mjs','structured-live.mjs')) { [System.IO.File]::WriteAllText((Join-Path $fixture $name),$trap) }
  foreach ($name in @('judge-start.mjs','judge-install.mjs')) {
    $r = Invoke-Owned $node @((Join-Path $fixture "scripts/$name"),'--consent-typing','--access',(Join-Path $fixture 'absent.json')) $fixture 10000
    if ($r.exit -ne 1 -or !$r.stderr.Contains('Native Windows is not supported. Use WSL2') -or (Test-Path -LiteralPath $marker)) { throw 'windows_guard_unqualified' }
    if ($name -eq 'judge-start.mjs') { $report.guard_start=$true } else { $report.guard_install=$true }
  }

  $handler = [System.Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect=$false; $handler.UseCookies=$false; $handler.UseProxy=$false; $handler.UseDefaultCredentials=$false
  $http = [System.Net.Http.HttpClient]::new($handler); $http.Timeout = [TimeSpan]::FromSeconds(180)
  $http.DefaultRequestHeaders.UserAgent.ParseAdd('Area2-Muse-Qualification/1.0')
  $manifestPath = Join-Path $private 'manifest.json'; Receive-Official $manifestUrl $manifestPath 262144
  $manifest = [System.IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
  $entry = $manifest.artifacts.($pin.key)
  $expectedUrl = "https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=$version&file=$($pin.file)"
  if ($manifest.version -cne $version -or $manifest.checksum_algorithm -cne 'sha256' -or $entry.url -cne $expectedUrl -or $entry.checksum -cne $pin.sha -or [long]$entry.size -ne $pin.size) { throw 'manifest_unqualified' }
  [void](Assert-OfficialUri $entry.url); $report.manifest_verified=$true
  $binary = Join-Path $private 'muse.exe'; Receive-Official $entry.url $binary $pin.size
  if ((Get-Item -LiteralPath $binary).Length -ne $pin.size -or (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin.sha) { throw 'artifact_unqualified' }
  $report.artifact_verified=$true; $report.muse_sha256=$pin.sha
  $workspace = Join-Path $private 'workspace'; [void][System.IO.Directory]::CreateDirectory($workspace)
  $echoArguments = @('exec','--json','--provider','echo','--preset','empty','--contributor-mode','off','--max-model-steps','1','--workspace',$workspace,'--no-session-log','--no-foreign-personal-context','--disable-reminders','--disable-web-tools','--disable-request-user-input','--disable-shell','--disable-write','--approval-mode','on-request','--approval-judge','off','Synthetic Echo probe.')
  $r = Invoke-Owned $binary $echoArguments $workspace 30000
  if ($r.exit -ne 0) { throw 'echo_exit_failed' }
  $completed=0; $usage=$null; $usageEvents=0; $eventCount=0
  foreach ($line in ($r.stdout -split "`n")) {
    if (!$line.Trim()) { continue }; $eventCount++; if ($eventCount -gt 1024) { throw 'echo_output_invalid' }
    $record = $line | ConvertFrom-Json; $type = [string]$record.payload_type
    if (!$type -or $type -match '(?i)(subagent|child|approval|tool)[._]') { throw 'echo_event_unqualified' }
    if ($type -eq 'run.usage') { $usageEvents++; $calls=$record.payload.calls; if ($usageEvents -gt 1 -or !($calls -is [int] -or $calls -is [long]) -or $calls -lt 0 -or $calls -gt 1) { throw 'echo_usage_unqualified' }; $usage=[int]$calls }
    if ($type -eq 'run.terminal.completed' -and $record.payload.terminal -eq 'completed') { $completed++ }
    if ($type -match '^run\.terminal\.(failed|cancelled)$') { throw 'echo_terminal_unqualified' }
  }
  if ($completed -ne 1) { throw 'echo_terminal_unqualified' }
  $report.echo_terminal_completed=$true; $report.echo_usage_calls=$usage; $report.reason=$null; $report.status='passed'
} catch {
  $allowed=@('windows_powershell7_required','unsafe_home_assignment','architecture_unsupported','private_directory_unqualified','node_version_unqualified','windows_guard_unqualified','url_rejected','download_redirect_rejected','download_unavailable','download_too_large','manifest_unqualified','artifact_unqualified','process_start_failed','process_timeout','process_stream_timeout','process_output_limit','echo_exit_failed','echo_output_invalid','echo_event_unqualified','echo_usage_unqualified','echo_terminal_unqualified')
  $report.reason = if ($allowed -contains $_.Exception.Message) { $_.Exception.Message } else { 'probe_failed' }; $report.status='failed'
} finally {
  if ($http) { $http.Dispose() }
  $clean = $true
  foreach ($p in $processes) { try { if (!$p.HasExited) { $p.Kill($true); if (!$p.WaitForExit(5000)) { $clean=$false } } } catch { $clean=$false }; $p.Dispose() }
  if ($private) { try { Remove-Item -LiteralPath $private -Recurse -Force -ErrorAction Stop; if (Test-Path -LiteralPath $private) { $clean=$false } } catch { $clean=$false } }
  $report.owned_parents_and_files_cleanup_confirmed=$clean
  if (!$clean) { $report.status='failed'; $report.reason='owned_cleanup_unconfirmed' }
}
$report | ConvertTo-Json -Depth 5 -Compress
if ($report.status -ne 'passed') { exit 1 }

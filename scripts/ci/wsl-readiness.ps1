# Runs only in the disposable GitLab Windows job. Never receives account secrets.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$report=[ordered]@{schema_version=1; scope='hosted_wsl2_echo'; status='unavailable'; reason='wsl2_unavailable'; distribution='Ubuntu-24.04'; kernel=$null; node_version=$null; muse_version=$null; echo_completed=$false; distribution_stopped=$false; actual_model_calls=0; op_calls=0; login='not_attempted'; credential_values_supplied=$false; limits=@('no_real_login','no_authenticated_model_request','no_full_coding_workflow')}
$wsl=$null; $used=$false; $children=[System.Collections.Generic.List[System.Diagnostics.Process]]::new()
function Invoke-WSL([string[]]$arguments,[int]$timeout,[string]$inputText='') {
  $info=[System.Diagnostics.ProcessStartInfo]::new();$info.FileName=$script:wsl
  foreach($argument in $arguments){[void]$info.ArgumentList.Add($argument)}
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $info.Environment.Clear()
  foreach($name in @('SystemRoot','WINDIR','PATH','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP')){if(Test-Path "env:$name"){$info.Environment[$name]=[Environment]::GetEnvironmentVariable($name)}}
  $p=[System.Diagnostics.Process]::new();$p.StartInfo=$info
  if(!$p.Start()){throw 'wsl_start_failed'};$script:children.Add($p)
  $out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync()
  if($inputText){$p.StandardInput.Write($inputText)};$p.StandardInput.Close()
  if(!$p.WaitForExit($timeout)){try{$p.Kill($true)}catch{};throw 'wsl_timeout'}
  if(!$out.Wait(1000) -or !$err.Wait(1000)){throw 'wsl_stream_unconfirmed'}
  if($out.Result.Length -gt 65536 -or $err.Result.Length -gt 65536){throw 'wsl_output_limit'}
  return @{code=$p.ExitCode;text=$out.Result.Replace([string][char]0,'')}
}
try {
  if(!$IsWindows -or $PSVersionTable.PSVersion.Major -lt 7 -or $env:CI_SERVER_HOST -ne 'gitlab.com' -or $env:CI_PROJECT_PATH -ne 'area2.ai/a2-fun/a2-presence-muse'){throw 'ephemeral_ci_required'}
  $script:wsl=(Get-Command wsl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $list=Invoke-WSL @('--list','--quiet') 15000
  if($list.text -notmatch '(?m)^\s*Ubuntu-24\.04\s*$'){
    $installed=Invoke-WSL @('--install','--distribution','Ubuntu-24.04','--no-launch','--web-download') 150000
    if($installed.code -ne 0){throw 'wsl2_install_unavailable'}
  }
  $used=$true
  $kernel=Invoke-WSL @('--distribution','Ubuntu-24.04','--user','root','--exec','uname','-r') 30000
  if($kernel.code -ne 0 -or $kernel.text.Trim() -notmatch '^[\w.+-]*[Mm]icrosoft[\w.+-]*WSL2[\w.+-]*$'){throw 'wsl2_kernel_unqualified'}
  $report.kernel=$kernel.text.Trim()
  $scriptText=[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wsl-echo.sh'))
  $probe=Invoke-WSL @('--distribution','Ubuntu-24.04','--user','root','--exec','/bin/bash','--noprofile','--norc','-s') 240000 $scriptText
  if($probe.code -ne 0){throw 'wsl_echo_unqualified'}
  $result=$probe.text | ConvertFrom-Json
  if($result.status -ne 'passed' -or $result.node_version -ne '22.12.0' -or $result.muse_version -ne '1.4.14-R7309.1' -or !$result.echo_completed){throw 'wsl_echo_unqualified'}
  $report.node_version=$result.node_version;$report.muse_version=$result.muse_version;$report.echo_completed=$true;$report.status='passed';$report.reason=$null
}catch{
  $known=@('ephemeral_ci_required','wsl_start_failed','wsl_timeout','wsl_stream_unconfirmed','wsl_output_limit','wsl2_install_unavailable','wsl2_kernel_unqualified','wsl_echo_unqualified')
  $report.reason=if($known -contains $_.Exception.Message){$_.Exception.Message}else{'wsl2_unavailable'}
}finally{
  foreach($p in $children){try{if(!$p.HasExited){$p.Kill($true);[void]$p.WaitForExit(3000)}}catch{}}
  if($used -and $wsl){try{$stopped=Invoke-WSL @('--terminate','Ubuntu-24.04') 10000;$report.distribution_stopped=$stopped.code -eq 0}catch{}}
  foreach($p in $children){$p.Dispose()}
  if($used -and !$report.distribution_stopped){$report.status='failed';$report.reason='wsl_cleanup_unconfirmed'}
}
$report | ConvertTo-Json -Depth 5 -Compress
if($report.status -ne 'passed'){exit 2}

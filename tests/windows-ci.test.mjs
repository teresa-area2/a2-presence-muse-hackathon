import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';

const read=name=>fs.readFile(new URL('../'+name,import.meta.url),'utf8');
test('Windows CI is explicit, bounded and exports only the three metadata reports',async()=>{
  const yaml=await read('.gitlab-ci.yml');
  assert.match(yaml,/CI_PIPELINE_SOURCE == "api" && \$A2_WINDOWS_QUALIFICATION == "1"/);
  assert.match(yaml,/when: never/);assert.match(yaml,/timeout: 10m/);assert.match(yaml,/retry: 0/);
  assert.doesNotMatch(yaml,/secrets:|META_API_KEY|NPM_TOKEN|CI_JOB_TOKEN|\.local\/|\.npmrc/);
  const reports=[...yaml.matchAll(/- qualification\/(.+\.json)/g)].map(m=>m[1]);
  assert.deepEqual(reports,['bootstrap.json','windows-native.json','wsl-readiness.json']);
});
test('CI profiles supply no account credentials and preserve the Echo-only boundary',async()=>{
  const windows=await read('scripts/ci/windows-muse-probe.ps1'),wsl=await read('scripts/ci/wsl-echo.sh'),boot=await read('scripts/ci/bootstrap-windows.ps1');
  assert.match(windows,/Environment\.Clear\(\)/);assert.match(boot,/EnvironmentVariables\.Clear\(\)/);
  assert.doesNotMatch(windows+boot,/\$(?:script:)?home\s*=/im);
  assert.match(windows,/'--provider','echo'/);assert.match(wsl,/--provider echo/);
  for(const source of [windows,wsl]){assert.match(source,/--contributor-mode[', ]+off/);assert.match(source,/--disable-shell/);assert.match(source,/--disable-write/);}
  assert.doesNotMatch(boot,/EnvironmentVariables\['PATH'\].*\$env:PATH/);
  assert.match(boot,/submission_credentials_must_not_enter_ci/);
});
const pwsh=process.env.A2_POWERSHELL_PARSER;
test('official download client identifies its requests without sending account authorization', {skip:!pwsh},async()=>{
  const source=await read('scripts/ci/windows-muse-probe.ps1');
  const start=source.indexOf('  $handler = [System.Net.Http.HttpClientHandler]::new()'),end=source.indexOf('  $manifestPath =',start);
  assert.ok(start>=0&&end>start);
  let observed;
  const server=http.createServer((request,response)=>{observed=request.headers;response.end('ok');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const script=`$ErrorActionPreference='Stop';${source.slice(start,end)};try{[void]$http.GetStringAsync('http://127.0.0.1:${server.address().port}/manifest').GetAwaiter().GetResult();Write-Output 'REQUEST_PASS'}finally{$http.Dispose()}`;
    const child=spawn(pwsh,['-NoLogo','-NoProfile','-Command',script],{env:{PATH:process.env.PATH,HOME:process.env.HOME,POWERSHELL_TELEMETRY_OPTOUT:'1'},stdio:['ignore','pipe','pipe']});
    let output='',error='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
    const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    let code;try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{clearTimeout(timer);}
    assert.equal(code,0,error);assert.match(output,/REQUEST_PASS/);
    assert.equal(observed?.['user-agent'],'Area2-Muse-Qualification/1.0');
    assert.equal(observed?.authorization,undefined);assert.equal(observed?.cookie,undefined);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('production report projection discards unknown fields and rejects malformed counters', {skip:!pwsh},async()=>{
  const source=await read('scripts/ci/bootstrap-windows.ps1');
  const start=source.indexOf('  $raw=$text | ConvertFrom-Json'),end=source.indexOf('  $name=if($Mode',start);
  assert.ok(start>=0&&end>start);
  const block=source.slice(start,end),literal=s=>"'"+s.replaceAll("'","''")+"'";
  const fixture={schema_version:1,status:'passed',reason:null,scope:'windows_native_echo_only',provider:'echo',credential_values_supplied:false,manifest_verified:true,artifact_verified:true,guard_start:true,guard_install:true,echo_terminal_completed:true,owned_parents_and_files_cleanup_confirmed:true,muse_sha256:'a'.repeat(64),os_version:'10.0.20348',architecture:'X64',node_version:'22.12.0',echo_usage_calls:1,unexpected_auth:'PRIVATE_SENTINEL_MUST_NOT_ESCAPE'};
  const script=`$ErrorActionPreference='Stop';$Mode='native';$text=${literal(JSON.stringify(fixture))};$code=[scriptblock]::Create(${literal(block)});. $code;$json=$report|ConvertTo-Json -Compress;if($json.Contains('PRIVATE_SENTINEL') -or $json.Contains('unexpected_auth')){throw 'unknown_field_retained'};$bad=ConvertFrom-Json $text;$bad.echo_usage_calls='1';$text=$bad|ConvertTo-Json -Compress;$rejected=$false;try{. $code}catch{$rejected=$true};if(!$rejected){throw 'malformed_counter_accepted'};Write-Output 'REPORT_PROJECTION_PASS'`;
  const result=spawnSync(pwsh,['-NoLogo','-NoProfile','-Command',script],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,HOME:process.env.HOME,POWERSHELL_TELEMETRY_OPTOUT:'1'}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/REPORT_PROJECTION_PASS/);assert.doesNotMatch(result.stdout,/PRIVATE_SENTINEL/);
});

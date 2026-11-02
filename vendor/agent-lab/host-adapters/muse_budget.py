"""Private admission guard for an owned Muse harness; never reads Presence."""
import argparse
import fcntl
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import time

CAPABILITY='plugin:area2-harness-budget:hook:pre-llm'

def private_file(path,forbidden=0o077):
    path=Path(path)
    if path.is_symlink():raise ValueError('budget_state_unsafe')
    info=path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&forbidden or info.st_size>16384:
        raise ValueError('budget_state_unsafe')
    return path

def create_state(path,workspace,max_generations,seconds):
    path=Path(path).absolute();workspace=Path(workspace).resolve(strict=True)
    # The model's writable task workspace must not contain its own guard state.
    if path.resolve().is_relative_to(workspace) or not 1<=max_generations<=32 or not 1<=seconds<=600:
        raise ValueError('budget_configuration_invalid')
    parent=path.parent
    if parent.is_symlink():raise ValueError('budget_parent_unsafe')
    parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=parent.stat()
    if info.st_uid!=os.getuid() or info.st_mode&0o077:raise ValueError('budget_parent_unsafe')
    value={'schema_version':1,'workspace':str(workspace),'max_generations':max_generations,
           'seconds':seconds,'started_monotonic':None,'generations_reserved':0,'blocked':0}
    with open(path,'x',opener=lambda p,flags:os.open(p,flags,0o600)) as stream:
        stream.write(json.dumps(value)+'\n')
    return path

def reserve(path,workspace,now=None,request_ids=None):
    path=private_file(path);workspace=str(Path(workspace).resolve(strict=True))
    with path.open('r+') as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        value=json.load(stream)
        if (value.get('schema_version')!=1 or value.get('workspace')!=workspace
                or type(value.get('max_generations')) is not int or not 1<=value['max_generations']<=32
                or type(value.get('seconds')) is not int or not 1<=value['seconds']<=600
                or type(value.get('generations_reserved')) is not int or value['generations_reserved']<0):
            raise ValueError('budget_state_invalid')
        clock=time.monotonic() if now is None else now
        start=value.get('started_monotonic')
        if start is None:value['started_monotonic']=start=clock
        if not isinstance(start,(float,int)) or isinstance(start,bool) or start>clock:raise ValueError('budget_clock_invalid')
        allowed=value['generations_reserved']<value['max_generations'] and clock-start<value['seconds']
        if allowed:value['generations_reserved']+=1
        else:value['blocked']=value.get('blocked',0)+1
        if request_ids is not None:
            value['last_request_ids']={k:v for k,v in request_ids.items()
                                      if k in {'session_id','run_id','turn_id'} and isinstance(v,str)
                                      and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',v)}
        stream.seek(0);stream.truncate();json.dump(value,stream);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        return allowed,value

def generate(workspace,state):
    workspace=Path(workspace).resolve(strict=True);state=private_file(state).resolve()
    root=state.parent/'budget-plugin'
    root.mkdir(mode=0o700,exist_ok=False);(root/'.muse-plugin').mkdir(mode=0o700)
    helper=root/'guard.py';helper.write_bytes(Path(__file__).read_bytes());helper.chmod(0o600)
    manifest={'schemaVersion':1,'name':'area2-harness-budget','displayName':'Area2 harness request budget',
              'version':'0.1.0','description':'Same technical admission guard in both arms; no Presence read.',
              'compat':{'source':'native','manifestDir':'.muse-plugin'},
              'capabilities':{'skills':[],'commands':[],'hooks':[{'id':'pre-llm','event':'PreLLMCall',
                  'command':[sys.executable,'-B',str(helper),'hook','--workspace',str(workspace),'--state',str(state)],
                  'timeoutMs':3000}],'mcpServers':[],'reminders':[]}}
    (root/'.muse-plugin/plugin.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return root

def install(bundle,workspace,binary,config):
    from muse_boundary import native_environment,review_user_settings,checked_capability
    review_user_settings()
    config=Path(config).absolute()
    if config.is_symlink():raise ValueError('budget_config_unsafe')
    config.mkdir(mode=0o700,exist_ok=False)
    (config/'muse').mkdir(mode=0o700)
    env=native_environment(workspace);env['XDG_CONFIG_HOME']=str(config)
    for argv in ([binary,'plugins','validate',str(bundle),'--json'],
                 [binary,'plugins','install',str(bundle),'--scope','user','--json'],
                 [binary,'plugins','approve','area2-harness-budget:hook:pre-llm','--json']):
        result=subprocess.run(argv,cwd=workspace,env=env,capture_output=True,text=True,timeout=20)
        if result.returncode:raise ValueError('budget_plugin_setup_failed')
        if argv[2]=='validate':
            value=json.loads(result.stdout)
            if value.get('valid') is not True or value.get('diagnostics'):raise ValueError('budget_plugin_invalid')
    if (config/'muse/auth.json').exists() or (config/'muse/auth.json').is_symlink():raise ValueError('budget_config_auth_refused')
    settings=private_file(config/'muse/settings.json',forbidden=0o022)
    value=json.loads(settings.read_text())
    if set(value)-{'schema_version','tui','runtime_capabilities'} or set(value.get('runtime_capabilities',{}))!={CAPABILITY}:
        raise ValueError('budget_approval_invalid')
    capability=checked_capability(value['runtime_capabilities'][CAPABILITY])
    if capability['enabled'] is not True:raise ValueError('budget_approval_invalid')
    return capability

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','hook'])
    parser.add_argument('--workspace',type=Path,required=True);parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--max-generations',type=int,default=32);parser.add_argument('--seconds',type=int,default=600)
    parser.add_argument('--muse');parser.add_argument('--approval-config',type=Path)
    args=parser.parse_args()
    if args.action=='prepare':
        if not args.muse or not args.approval_config:parser.error('prepare requires native binary and private approval config')
        create_state(args.state,args.workspace,args.max_generations,args.seconds)
        bundle=generate(args.workspace,args.state)
        capability=install(bundle,args.workspace,args.muse,args.approval_config)
        print(json.dumps({'capability_id':CAPABILITY,'capability':capability,'bundle':str(bundle)}))
    else:
        # Native experiment on1.4.13 proved decision:block/exit2 stops admission;
        # continue:false was ignored. Fail closed on missing or invalid state.
        try:
            incoming=json.loads(sys.stdin.buffer.read(1000001))
            if incoming.get('hook_event_name')!='PreLLMCall' or Path(incoming.get('cwd','')).resolve()!=args.workspace.resolve():
                raise ValueError('budget_scope_invalid')
            allowed,_=reserve(args.state,args.workspace,request_ids=incoming)
            if not allowed:raise ValueError('budget_exhausted')
            print('{}')
        except Exception:
            print(json.dumps({'decision':'block','reason':'Owned harness request budget unavailable or exhausted.'}))

if __name__=='__main__':main()

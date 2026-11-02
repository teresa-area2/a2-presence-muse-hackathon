"""Exact-workspace, read-only native index lookup. Outputs no prompts or titles."""
import json,os,pathlib,re,sqlite3,stat,sys
host,workspace,home=sys.argv[1:4];home=pathlib.Path(home)
owned=None
def fail(error):
 print(json.dumps({'files':[],'limited':False,'error':error}));sys.exit(0)
if len(sys.argv)>4:
 try:
  owned=json.loads(sys.argv[4])
  if (host!='muse' or len(sys.argv)!=5 or not isinstance(owned,dict)
      or set(owned)!={'sessionId','runId'}
      or any(not isinstance(v,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',v) for v in owned.values())):
   raise ValueError('invalid assignment')
 except (ValueError,TypeError):fail('invalid_owned_session')
 if not pathlib.Path(workspace).is_absolute() or pathlib.Path(workspace).is_symlink():fail('unsafe_native_data')

def omitted_live_only(record):
 # Only native ephemeral tool-delta retention markers may use position identity.
 # An unknown marker cannot borrow a valid committed id to bypass this shape.
 if (not isinstance(record,dict)
     or set(record)!={'schema_version','stream','position','retained_marker','omitted_record'}
     or type(record['schema_version']) is not int or record['schema_version']!=1
     or record['retained_marker']!='omitted_live_only'):
  return False
 stream=record['stream'];position=record['position'];omitted=record['omitted_record']
 return (isinstance(stream,dict) and set(stream)=={'kind','id'} and stream['kind']=='session'
     and isinstance(stream['id'],str) and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',stream['id']) is not None
     and isinstance(position,dict) and set(position)=={'id','sequence'}
     and isinstance(position['id'],str) and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',position['id']) is not None
     and type(position['sequence']) is int and 0<=position['sequence']<=9007199254740991
     and isinstance(omitted,dict) and set(omitted)=={'record_type','durability','payload_type','payload_schema_version','payload_kind','omission_class'}
     and omitted['record_type']=='status' and omitted['durability']=='ephemeral'
     and omitted['payload_type']=='runtime.session' and type(omitted['payload_schema_version']) is int and omitted['payload_schema_version']==1
     and omitted['payload_kind']=='task' and omitted['omission_class']=='task_tool_delta_v1')

def verify_owned_log(log,root):
 # Explicit assignments never read a redirected log, even when it resolves
 # elsewhere inside the same isolated registry. No content is returned.
 if not log.is_absolute() or '..' in log.parts:raise ValueError('unsafe log')
 relative=log.relative_to(root)
 for part in (root,*[root.joinpath(*relative.parts[:i]) for i in range(1,len(relative.parts)+1)]):
  if part.is_symlink():raise ValueError('linked log path')
 info=log.stat()
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_size>8*1024*1024:
  raise ValueError('unsafe log')
 seen={};sequences={};metadata=[];matched=False
 def flatten(record,depth=0):
  if depth>32:raise ValueError('nested record limit')
  if not isinstance(record,dict):return
  if isinstance(record.get('children'),list):
   for child in record['children']:yield from flatten(child,depth+1)
  yield record
 with log.open() as source:contents=source.read(8*1024*1024+1)
 if len(contents)>8*1024*1024:raise ValueError('log size limit')
 bound_events={'user_prompt_display','model_response_created','model_completed','assistant_message_committed','assistant_tool_calls_committed','tool_result_batch_committed','terminal','hook_run_started','hook_run_terminal','context_block_updated','model_input_trace_recorded'}
 for line in contents.splitlines():
  if not line.strip():continue
  for record in flatten(json.loads(line)):
   stream=record.get('stream') or {}
   if stream.get('kind')!='session':continue
   if stream.get('id')!=owned['sessionId']:raise ValueError('foreign session')
   retained='retained_marker' in record
   if retained and not omitted_live_only(record):raise ValueError('invalid retained marker')
   identity=record['position'] if retained else record
   rid=identity.get('id')
   seq=identity.get('sequence')
   if not isinstance(rid,str) or type(seq) is not int or seq<0:raise ValueError('missing record identity')
   if rid in seen and seen[rid]!=record:raise ValueError('conflicting record')
   if seq in sequences and sequences[seq]!=rid:raise ValueError('conflicting sequence')
   seen[rid]=record
   sequences[seq]=rid
   payload=record.get('payload') or {}
   if record.get('payload_type')=='runtime.session' and payload.get('event',{}).get('kind') in bound_events:
    value=payload.get('run_id')
    if not isinstance(value,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',value):raise ValueError('unbound run event')
    # Response/message linkage for Presence provenance: when a committed
    # message carries response_id/message_id, they must be well-formed
    # identifiers. Absent fields stay unbound (provenance unknown); malformed
    # fields fail closed. Raw text is never inspected here.
    event=payload.get('event',{})
    if event.get('kind')=='assistant_message_committed':
     for key in ('message_id','response_id'):
      marker=event.get(key)
      if marker is not None and (not isinstance(marker,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}',marker)):raise ValueError('invalid committed identity')
    if event.get('kind')=='model_response_created':
     marker=event.get('response_id')
     if marker is not None and (not isinstance(marker,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}',marker)):raise ValueError('invalid response identity')
   if record.get('payload_type')=='runtime.session.metadata':
    metadata.append(payload.get('record',{}).get('workspace_root'))
   if record.get('payload_type')=='runtime.session' and payload.get('run_id')==owned['runId']:
    matched=True
 if not metadata or any(value!=workspace for value in metadata) or not matched:
  raise ValueError('unverified assignment')
if host=='codex':
 dbs=sorted((home/'.codex').glob('state_*.sqlite'),key=lambda p:int(p.stem.split('_')[-1]) if p.stem.split('_')[-1].isdigit() else -1,reverse=True)
 database=dbs[0] if dbs else home/'.codex/state_5.sqlite'
 query="SELECT id,rollout_path FROM threads WHERE cwd=? AND source IN ('cli','exec') ORDER BY created_at DESC LIMIT 17"
 root=home/'.codex/sessions'
else:
 folder=pathlib.Path(workspace)/'.presence'
 isolated=folder/'muse-native-data'
 native=isolated/'muse'
 try:
  for path in (folder,isolated,native):
   try:info=path.lstat()
   except FileNotFoundError:continue
   forbidden=0o022 if path==native else 0o077
   if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid()
       or info.st_mode&forbidden or not path.resolve().is_relative_to(pathlib.Path(workspace).resolve())):
    raise ValueError('unsafe native data')
 except (OSError,ValueError):
  print(json.dumps({'files':[],'limited':False,'error':'unsafe_native_data'}));sys.exit(0)
 if owned and not all(p.is_dir() for p in (folder,isolated,native)):
  fail('owned_session_unavailable')
 data=native if isolated.exists() else home/'.local/share/muse'
 database=data/'session-index.db'
 query="SELECT session_id,session_log_path FROM sessions WHERE workspace_root=? AND msp_kind='root' AND msp_parent_session_id IS NULL ORDER BY COALESCE(msp_created_at_us,created_at_us) DESC LIMIT 17"
 root=data/'sessions'
try:
 if host!='codex' and (root.is_symlink() or not root.resolve().is_relative_to(data.resolve())):
  raise ValueError('unsafe sessions root')
 if database.is_symlink():raise ValueError('unsafe index')
 connection=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=1)
 if owned:
  rows=connection.execute('SELECT session_id,session_log_path,workspace_root,msp_kind,msp_parent_session_id FROM sessions WHERE session_id=?',(owned['sessionId'],)).fetchall()
 else:rows=connection.execute(query,(workspace,)).fetchall()
 connection.close()
 if owned:
  if len(rows)!=1 or rows[0][2]!=workspace or rows[0][3] not in (None,'root') or rows[0][4] is not None:
   fail('owned_session_mismatch')
  sid,filename=rows[0][:2];log=pathlib.Path(filename)
  if not log.resolve().is_relative_to(root.resolve()):raise ValueError('escaped log')
  verify_owned_log(log,root)
  print(json.dumps({'files':[{'id':sid,'path':str(log),'runId':owned['runId']}],'limited':False,'error':None}));sys.exit(0)
 files=[]
 for sid,filename in rows[:16]:
  f=pathlib.Path(filename)
  if f.is_symlink() or not f.resolve().is_relative_to(root.resolve()):continue
  files.append({'id':sid,'path':str(f)})
 print(json.dumps({'files':files,'limited':len(rows)>16,'error':None}))
except (OSError,ValueError,TypeError,AttributeError,sqlite3.Error):
 print(json.dumps({'files':[],'limited':False,'error':'native_index_unavailable'}))

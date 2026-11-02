// Read-only snapshot of the two owned task workspaces, never caller-supplied paths.
import {collectArtifactFilesWithBytes,hashArtifactFiles} from './artifact-source.mjs';
const ARMS=['without','with'],HEX=/^[a-f0-9]{64}$/;
const excluded=path=>/(?:^|\/)(?:AGENTS|CLAUDE|MUSE)\.md$|(?:^|\/)\.env(?:\.|$)/i.test(path);
const testPath=path=>/(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.(?:[cm]?js|jsx)$/.test(path);
const priority=path=>/^(?:TASK|CONTRACT)\.md$/.test(path)?0:/^(?:src|app|lib)\//.test(path)?1:testPath(path)?3:2;
export async function captureObserverWork(pair,{collect=collectArtifactFilesWithBytes}={}){
 const out={};
 for(const arm of ARMS){let snapshot;
  try{
   const workspace=pair?.arms?.[arm]?.workspace;if(typeof workspace!=='string')throw Error('work_unavailable');
   snapshot=await collect(workspace,'project');const digest=hashArtifactFiles(snapshot.files);if(!HEX.test(digest))throw Error('work_invalid');
   const candidates=snapshot.files.filter(f=>!excluded(f.path)).sort((a,b)=>priority(a.path)-priority(b.path)||a.path.localeCompare(b.path));
   let bytes=0;const files=[];
   for(const file of candidates){const data=snapshot.bytes.get(file.path);if(!Buffer.isBuffer(data)||data.includes(0)||files.length>=10||bytes+data.length>16000)continue;const text=data.toString('utf8');if(!Buffer.from(text).equals(data))continue;files.push({...file,text});bytes+=data.length;}
   const latest=pair.codeChecks?.snapshot?.()?.arms?.[arm]?.latest;
   const checked=latest?.current===true && ['passed','failed'].includes(latest.status) && latest.summary?.artifact_sha256===digest;
   out[arm]={status:'observed',captured_at:new Date().toISOString(),retained_final_snapshot:false,artifact_sha256:digest,files,omitted_files:snapshot.files.length-files.length,checks:checked?structuredClone(latest.summary):null};
  }catch{out[arm]={status:'unavailable',artifact_sha256:null,files:[],omitted_files:0,checks:null};}
  finally{snapshot?.bytes?.clear();}
 }
 return out;
}

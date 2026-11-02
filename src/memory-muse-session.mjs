import {initializeMuseProtocol} from './muse-protocol.mjs';
// Qualify the real memory-only Muse session before allowing any turns.
// The caller owns the spawned process and must stop it on any failure.
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
export function humanSandboxPosture(s){const a=s?.axes;return s?.reviewerAuthority==='human'&&s.reviewerAttached===true&&a?.filesystem==='sandboxed'&&['off','restricted'].includes(a?.network)&&a?.approval==='onRequest'&&a?.reviewer==='human';}
export async function openMemoryMuseSession({client,workspace,makeId,modelId,nativeQuestions=false}){
 if(typeof nativeQuestions!=='boolean'||!client||typeof client.initialize!=='function'||typeof client.request!=='function'||client.sessionId||typeof workspace!=='string'||!workspace.startsWith('/')||typeof makeId!=='function')throw Error('memory_session_invalid');
 const init=await initializeMuseProtocol(client,{experimentalApi:true,userInputDialogs:nativeQuestions});if(init?.sandboxAvailability!=='available')throw Error('memory_sandbox_unavailable');
 const sessionId=makeId(),commandId=makeId();if(!uuid(sessionId)||!uuid(commandId)||sessionId===commandId)throw Error('memory_session_invalid_id');
 client.sessionId=sessionId;client.startCommandId=commandId;
 const result=await client.request('session/start',{sessionId,commandId,workspaceRoot:workspace,approvalMode:'onRequest',...(modelId?{modelId,providerId:'meta'}:{})}),s=result?.session;
 if(s?.sessionId!==sessionId||s.workspaceRoot!==workspace||s.parentSessionId||s.forkedFrom||s.sideFrom||s.spawnedBy||s.approvalMode?.mode!=='onRequest'||!humanSandboxPosture(s.permissionState)||s.path)throw Error('memory_session_posture_unqualified');
 if(modelId&&s.modelId!==undefined&&s.modelId!==modelId)throw Error('memory_session_model_unqualified');
 return s;
}

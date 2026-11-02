// Exact native schema exports reviewed for Muse 1.4.13 and 1.4.14.
// No request, browser setting or runtime variable can expand this allowlist.
import {MUSE_MSP_FINGERPRINT} from '../vendor/agent-lab/core/muse-msp.mjs';
const FINGERPRINT_1_4_14='sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6';
const approved=new Set([MUSE_MSP_FINGERPRINT,FINGERPRINT_1_4_14]);
export async function initializeMuseProtocol(client,{experimentalApi=true,userInputDialogs=false}={}){
 if(typeof experimentalApi!=='boolean'||typeof userInputDialogs!=='boolean'||typeof client?.request!=='function'||typeof client.write!=='function'||!approved.has(client.fingerprint))throw Error('user_input_client_unqualified');
 const result=await client.request('initialize',{clientInfo:{name:'area2_agent_lab',title:'Area2 Presence Muse harness',version:'m1'},capabilities:{experimentalApi,userInputDialogs,requestedCapabilities:[]}});
 if(result?.schema?.version!==1||!approved.has(result.schema.fingerprint)){client.abort?.('muse_schema_mismatch');throw Error('muse_schema_mismatch');}
 // Bind only after the host returned a reviewed exact fingerprint. This also
 // keeps later vendored operations associated with the actual host schema.
 client.fingerprint=result.schema.fingerprint;
 client.write({method:'initialized'});
 return{schema:result.schema,serverInfo:result.serverInfo,sandboxAvailability:result.sandboxAvailability??'unknown'};
}

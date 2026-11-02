import {createPresentationLedger} from '../../web/presentation-decisions.mjs';
export const DEFER={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
export function presentationFixture({count=2,send=false}={}){
 const arms={};
 for(const arm of ['without','with']){
  const ledger=createPresentationLedger({arm});
  arms[arm]=ledger.observe({session_generation:1,history_epoch:0,at_ms:1000,items:[...Array.from({length:count},(_,i)=>({kind:'message',ordinal:i+1,optional:true,visible:arm==='without'||send})),{kind:'message',ordinal:count+1,optional:false,visible:true}],...(arm==='with'?{policy:{mode:'eligible',controls:{...DEFER,unsolicited_update:send?'send':'defer'}}}:{})});
 }
 return{schema_version:1,arms};
}
export function maximumPresentation(generation=1){
 const max=Number.MAX_SAFE_INTEGER,epoch=max-1;
 const snapshot=arm=>({schema_version:1,source:'browser_current_display_policy',arm,session_generation:generation,history_epoch:epoch,revision:max,events_omitted:max-100,coverage:'partial',events:Array.from({length:100},(_,i)=>({sequence:max-99+i,revision:max,history_epoch:epoch,kind:'message',ordinal:4096,event:'shown',reason:arm==='with'?'not_held':'baseline',at_ms:8640000000000000,controls:arm==='with'?{response_extent:'standard',unsolicited_update:'defer',conversation_style:'conversational'}:null}))});
 return{schema_version:1,arms:{without:snapshot('without'),with:snapshot('with')}};
}

// Explicit generated feedback: each agent sees only its own artifact's result.
// The caller owns authentication/generation checks and normal action measurement.
export async function sendCIFeedback({service,pair,target,checks,isCurrent=()=>true}) {
  const names=target==='both'?['without','with']:['without','with'].includes(target)?[target]:null;
  if(!names||!service||typeof service.feedback!=='function'||typeof pair?.submit!=='function')throw Error('ci_feedback_invalid');
  const lease=await service.feedback(target,checks);
  if(!isCurrent())throw Error('ci_session_changed');
  const claimed=lease.commit(); // No await between the final claim and first dispatch.
  const results={};
  for(const arm of names){
    if(!isCurrent()){results[arm]={status:'not_started'};continue;}
    try {
      const result=await pair.submit(claimed.prompts[arm],arm,{expectedTurns:{[arm]:null}});
      const status=result?.arms?.[arm]?.status??(result?.status==='started'?'started':result?.status==='not_started'?'not_started':'unknown');
      results[arm]={status:['started','not_started'].includes(status)?status:'unknown'};
    } catch {results[arm]={status:'unknown'};}
  }
  const values=Object.values(results).map(x=>x.status);
  return {status:values.every(x=>x==='started')?'started':values.every(x=>x==='not_started')?'not_started':'partial_or_unconfirmed',arms:results,source:'generated_ci'};
}

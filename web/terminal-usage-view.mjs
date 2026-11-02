// Presentation only: numbers are observed per-arm trace projections, not bills.
const arms=['without','with'];
const numberFormat=new Intl.NumberFormat('en-US');
export function terminalUsageView(state){
 const values={},sources=new Set();let partial=false,invalid=false,diagnostic=false,observed=false,disagreement=false,traceUnavailable=false;
 for(const arm of arms){const u=state?.arms?.[arm]?.usage??{};values[arm]={};for(const [label,key] of [['calls','model_calls'],['input','input_tokens'],['output','output_tokens'],['cache','cache_read_tokens']]){const n=u[key];values[arm][label]=u.status==='observed'&&Number.isSafeInteger(n)&&n>=0?numberFormat.format(n):'—';}if(u.status==='observed'){observed=true;sources.add(u.source);}if(u.coverage==='partial_or_unconfirmed'||u.trace_coverage==='partial_or_unconfirmed')partial=true;if(u.status==='unavailable')invalid=true;if(u.diagnostic===true)diagnostic=true;if(u.source_disagreement==='different_unverified')disagreement=true;if(u.source==='native'&&u.trace_status==='unavailable')traceUnavailable=true;}
 let note=invalid?'A terminal’s usage is unavailable. A dash is not zero.':observed?(sources.has('native')?(sources.has('provider_trace')?'Muse session totals or available response traces.':'Muse session totals.'):sources.has('provider_trace')?'Completed-response trace totals.':'Observed usage may not include every call.'):'Usage counts are unavailable in these terminals. A dash is not zero.';
 if(observed)note+=' Cumulative across this session; cached input is already included in input tokens.';
 if(partial)note+=' Reported calls and token totals may be incomplete.';
 if(disagreement)note+=' Native and trace snapshots differ; native token totals are shown.';
 if(traceUnavailable)note+=' Response trace unavailable; completed-call counts are unavailable.';
 if(diagnostic)note+=' Muse also reported a local diagnostic.';
 note+=' Cost and collector overhead are not included.';return {values,note};
}

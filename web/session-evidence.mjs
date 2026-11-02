import {renderMarkdown} from './transcript-notice.mjs';
import {buildObserverExperience,observerLocalEvidence,projectObserverExperience,createObserverProgress,observerProgressReplies,presenceMomentView,presenceChangeLabel,presenceMomentReference,observerHighlightView,observerHighlightPolicy,observerSessionResources} from '../src/observer-comparison.mjs';
import {projectPresentationEnvelope} from './presentation-evidence.mjs';
const runId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const observerArmLabel=arm=>arm==='with'?'Muse + Presence':'Muse';

export function projectMechanismMetrics(value){
 const fields=['held_current','held_total','released_manual','released_automatic','history_resets'];
 if(!value||value.schema_version!==1||!['observed','partial'].includes(value.coverage)||fields.some(k=>!integer(value[k])))return null;
 const accounted=value.held_current+value.released_manual+value.released_automatic;
 if(!integer(accounted)||accounted>value.held_total||value.coverage==='observed'&&accounted!==value.held_total)return null;
 return{schema_version:1,...Object.fromEntries(fields.map(k=>[k,value[k]])),coverage:value.coverage};
}
export function projectMechanismLedger(value,generation){
 const metrics=projectMechanismMetrics(value?.metrics);
 if(!ledgerId(value?.ledger_id)||!integer(generation)||generation<1||value.session_generation!==generation||!integer(value.revision)||value.revision<1||!metrics)return null;
 const present=Object.hasOwn(value,'presentation'),presentation=present?projectPresentationEnvelope(value.presentation,generation):undefined;if(present&&!presentation)return null;
 return{schema_version:1,source:'browser_projection',ledger_id:value.ledger_id,session_generation:generation,revision:value.revision,metrics,...(present?{presentation}:{})};
}
export function projectObserverUsage(value){
 const fields=['model_calls','input_tokens','output_tokens','cache_read_tokens','elapsed_ms'];
 return{scope:'presence_observer',status:['observed','not_reported','invalid'].includes(value?.status)?value.status:'not_reported',...Object.fromEntries(fields.map(k=>[k,integer(value?.[k])?value[k]:null])),cost_usd:null};
}
export function projectObserverTotals(value){
 const keys=['reports','completed','failed','cancelled'];if(!value||keys.some(k=>!integer(value[k]))||value.completed+value.failed+value.cancelled!==value.reports)return null;
 return{...Object.fromEntries(keys.map(k=>[k,value[k]])),usage:projectObserverUsage(value.usage)};
}
const observerRecords=new WeakMap();
// Only the trusted service registers results after local fact-ID validation.
export function registerObserverReport(value){
 const record={};observerRecords.set(record,structuredClone(value));return record;
}
export function projectObserverReports(value,generation){
 if(!Array.isArray(value))return[];
 return value.slice(-8).map(r=>observerRecords.get(r)).filter(r=>ledgerId(r?.id)&&r.session_generation===generation&&['completed','failed','cancelled'].includes(r.status)&&typeof r.at==='string'&&Number.isFinite(Date.parse(r.at))&&typeof r.input_fingerprint==='string'&&/^[a-f0-9]{64}$/.test(r.input_fingerprint)).map(r=>({
  id:r.id,session_generation:generation,at:new Date(r.at).toISOString(),status:r.status,input_fingerprint:r.input_fingerprint,
  evidence_scope:{with_turn:integer(r.evidence_scope?.with_turn)&&r.evidence_scope.with_turn>0?r.evidence_scope.with_turn:null,without_turn:integer(r.evidence_scope?.without_turn)&&r.evidence_scope.without_turn>0?r.evidence_scope.without_turn:null,mechanism_ledger_id:ledgerId(r.evidence_scope?.mechanism_ledger_id)?r.evidence_scope.mechanism_ledger_id:null,mechanism_revision:integer(r.evidence_scope?.mechanism_revision)?r.evidence_scope.mechanism_revision:null},
  fact_ids:Array.isArray(r.fact_ids)?r.fact_ids.filter(x=>typeof x==='string'&&/^[a-z_]{1,48}$/.test(x)).slice(0,6):[],
  sentences:Array.isArray(r.sentences)?r.sentences.filter(x=>typeof x==='string'&&x.length<=1200).slice(0,6):[],
  ...(r.status==='completed'&&projectObserverExperience(r.experience)?{experience:projectObserverExperience(r.experience)}:{}),
  usage:projectObserverUsage(r.usage),model:'muse-spark-1.3',contributor_mode:'off',error:r.status==='completed'?null:'observer_explanation_unavailable'
 }));
}

// This ledger is per browser projection. Different tabs are never added together.
export function createMechanismSync({send,id=crypto.randomUUID()}={}){
 if(typeof send!=='function'||!ledgerId(id))throw Error('observer_sync_invalid');
 let connected=false,closed=false,current=null,pending=null,flight=null,failed=false,last='';
 function pump(){
  if(closed||!connected||flight||!pending||failed)return;
  const entry=pending;pending=null;
  flight=Promise.resolve().then(()=>send({generation:entry.session_generation,ledger:entry})).then(result=>{if(result?.ok!==true||result.generation!==entry.session_generation||result.accepted_revision!==entry.revision)throw Error('observer_metrics_unconfirmed');}).catch(()=>{if(!pending){failed=true;pending=entry;}}).finally(()=>{flight=null;if(!failed)pump();});
 }
 return{get id(){return id;},observe(metrics,generation,presentation){
  const clean=projectMechanismMetrics(metrics);if(closed||!clean||!integer(generation)||generation<1)return;
  const projected=presentation===undefined?undefined:projectPresentationEnvelope(presentation,generation);if(presentation!==undefined&&!projected){failed=true;return;}
  const key=JSON.stringify([generation,clean,projected]);if(last===key)return;last=key;
  const revision=current?.session_generation===generation?current.revision+1:1;
  current={schema_version:1,source:'browser_projection',ledger_id:id,session_generation:generation,revision,metrics:clean,...(projected?{presentation:projected}:{})};pending=current;failed=false;pump();
 },setConnected(value){const restored=!connected&&value===true;connected=value===true;if(restored){failed=false;pump();}},status(){return failed?'failed':flight||pending?'saving':current?'saved':'waiting';},async flush(){
  failed=false;for(let i=0;i<3;i++){pump();if(flight)await flight;if(failed)throw Error('observer_metrics_unsaved');if(!flight&&!pending)return;}
  throw Error('observer_metrics_unsaved');
 },close(){closed=true;}};
}


export function presentationDecisionLines(value,generation){
 const snapshot=projectPresentationEnvelope(value,generation)?.arms.with;
 if(!snapshot)return[];
 const reasons={mandatory:'essential message',defer:'optional updates deferred',baseline:'standard collaboration',manual:'you chose Show now',send:'updates now allowed',fallback:'ordinary fallback',disconnected:'connection lost',not_held:'not withheld'};
 return snapshot.events.slice(-8).map(row=>'With Presence · '+(row.kind==='approval'?'Approval ':row.kind==='question'?'Question ':'Message ')+row.ordinal+' '+row.event+' — '+reasons[row.reason]);
}

export function presenceObserverHtml(){return `<link rel="stylesheet" href="/presence-observer.css"><details class="card presence-observer" id="presence-observer" hidden>
 <summary>Presence observer <span class="observer-badge observer-beta">Beta</span> <span class="observer-subtitle">A short comparison of replies, work and Presence</span></summary>
 <section data-comparison-panel hidden aria-label="Muse comparison report">
 <div class="observer-report-intro"><div><p data-comparison-status role="status">Compare the exchanges, feedback, work and resource use.</p></div><button class="secondary" type="button" data-comparison-prepare>See Presence impact</button></div>
 <p class="footnote observer-disclosure">On request, Muse Spark 1.3 receives the recorded exchanges, selected work files, Presence and run metrics through Meta. Selected exchanges and code excerpts may contain private data or embedded credentials. Secret filtering is not comprehensive.</p>
 <div data-comparison-result data-comparison-summary-layout="concise-comparison-v6" hidden><section class="observer-overall" aria-label="Session assessment"><p class="observer-eyebrow">Muse assessment</p><p class="observer-muse-paragraph" data-comparison-paragraph></p><button type="button" class="observer-text-action" data-comparison-paragraph-more aria-expanded="false" hidden>Read full assessment</button></section><details class="observer-evidence" data-comparison-recorded-actions><summary>Recorded actions</summary><div data-comparison-recorded-action-table></div></details><figure class="observer-usage-graphic" data-comparison-usage-graph aria-label="Recorded run usage" hidden></figure><figure class="observer-work-graphic" aria-label="Selected comparison and side-by-side evidence"><div data-comparison-graphic></div></figure></div>
 <details class="observer-evidence" data-comparison-audit data-comparison-evidence hidden><summary>Details</summary><p class="observer-eyebrow" data-comparison-at></p><p data-comparison-context class="observer-context"></p><div data-comparison-resource-summary hidden></div><div data-comparison-session-resources></div><p class="observer-eyebrow">Recorded Presence guidance</p><p><span data-comparison-observed></span> <button type="button" class="observer-source-button" data-comparison-guidance-sources>Guidance</button></p><p><strong class="observer-assessment" data-comparison-verdict></strong></p><p class="footnote" data-comparison-linkage></p><p class="observer-eyebrow">Attribution note</p><p class="footnote" data-comparison-presence></p><div class="observer-detail-sources"><button type="button" class="observer-source-button" data-comparison-all-sources>Evidence JSON</button><button type="button" class="observer-source-button" data-comparison-paragraph-sources>Assessment</button><button type="button" class="observer-source-button" data-comparison-presence-sources>Presence</button><span data-comparison-node-sources></span></div><pre class="observer-source-json" data-comparison-sources></pre><p class="footnote" data-comparison-usage></p><pre class="observer-source-json" data-comparison-diagnostics></pre><p class="footnote">Included evidence</p><pre class="observer-source-json" data-comparison-coverage></pre></details>
 </section>
 <details data-observer-live class="observer-evidence"><summary>Live exchanges, side by side</summary>
 <div class="observer-overview"><p class="observer-eyebrow">Current local evidence · automatic</p><p data-observer-progress-summary aria-live="polite"></p><p class="observer-scope" data-observer-progress-scope></p></div>
 <div class="observer-moments" data-observer-moments role="group" aria-label="Compare task moments"></div>
 <p class="observer-guidance" data-observer-progress-guidance></p>
 <div class="observer-reply-pair" data-observer-replies></div>
 <p class="footnote observer-progress-limits">Earlier task moments are retained in this page.</p>
 </details>
 <details class="observer-evidence" data-observer-telemetry><summary>Evidence & telemetry</summary>
 <p class="footnote">Current session telemetry; the selected moment’s reading link is labeled separately below.</p><p data-observer-paragraph></p><p data-observer-scope></p><p data-observer-source></p><p data-observer-link></p><p data-observer-models></p><p data-observer-progress-link></p>
 <div class="observer-table-wrap"><table class="observer-dimensions"><caption>Experience dimensions · observed, self-reported, or unverified</caption><thead><tr><th scope="col">Dimension</th><th scope="col">Without</th><th scope="col">With Presence</th></tr></thead><tbody data-observer-dimensions></tbody></table></div>
 <details class="observer-evidence"><summary>Exact excerpts and reading references</summary><div data-observer-excerpts></div></details>
 <details class="observer-evidence"><summary>Optional-update delivery in this view</summary><p data-observer-tracker></p><ol data-observer-decisions></ol></details>
 <p class="footnote">Legacy facts-only explanation: quotes and messages are excluded from this explanation and the scrubbed export.</p>
 <div class="observer-actions"><button class="secondary" type="button" data-observer-explain>Explain recorded facts with Muse</button><span data-observer-status role="status"></span></div>
 <p class="footnote observer-disclosure">Makes a separate Spark 1.3 call with locally generated facts only. Muse selects relevant observations; that relevance is model-interpreted. It does not assess response depth or infer your state.</p>
 <p data-observer-time></p><p data-observer-highlight></p>
 <details class="observer-evidence" data-observer-report hidden><summary>Muse snapshot and supporting observations</summary><p data-observer-report-paragraph></p><ol data-observer-facts></ol></details><p data-observer-usage class="footnote"></p>
 </details>
</details>`;}

// Upgrade the old served shell without restarting its session-owning backend.
// Only fixed application markup is parsed; all reply content uses the inert renderer.
export function placeObserverLayout(container) {
 const doc=container.ownerDocument;
 if(!container.querySelector('[data-comparison-summary-layout="concise-comparison-v6"]')){
  const template=doc.createElement('template');template.innerHTML=presenceObserverHtml();
  const next=template.content.querySelector('#presence-observer');container.replaceChildren(...next.childNodes);
 }
 // Keep the optional observer inside its original diagnostics host.
 container.open=false;
 const utilities=doc.querySelector?.('#session-utilities');
 if(utilities && container.parentNode!==utilities)utilities.append(container);
 // Restore the original resource row if upgrading an already-mounted layout.
 const telemetry=doc.querySelector?.('[data-workspace-telemetry]');
 if(telemetry){const results=telemetry.querySelector('.results');if(results)telemetry.before(results);telemetry.remove();}
}

export function renderObserverProgress(container,view,{selected=view.latest_key,onSelect=()=>{}}={}) {
 const doc=container.ownerDocument,find=name=>container.querySelector('[data-observer-'+name+']');
 const moment=view.moments.find(x=>x.key===selected)??view.moments.at(-1);
 const summary=find('progress-summary');if(summary)summary.textContent=moment?.summary??view.summary;
 const scope=find('progress-scope');if(scope)scope.textContent=moment?.paired?'Reading links describe the request; the task itself may also change between turns.':moment?.label==='Current tasks'?'':moment?.scope??'';
 const guidance=find('progress-guidance');if(guidance)guidance.textContent=moment?moment.label+' · '+moment.guidance:'';
 const link=find('progress-link');if(link)link.textContent=moment?'Selected moment: '+moment.link:'';
 const nav=find('moments'),navKey=JSON.stringify(view.moments.map(x=>[x.key,x.label]));
 if(nav && nav.observerKey!==navKey){nav.observerKey=navKey;
  const wanted=new Set(view.moments.map(x=>x.key));for(const button of [...nav.children])if(!wanted.has(button.value))nav.removeChild(button);
  for(const row of view.moments){let button=[...nav.children].find(x=>x.value===row.key);if(!button){button=doc.createElement('button');button.type='button';button.className='secondary';button.value=row.key;button.addEventListener('click',()=>onSelect(row.key));nav.append(button);}button.textContent=row.label;}
 }
 if(nav)for(const button of nav.children)button.setAttribute('aria-pressed',String(button.value===moment?.key));
 const host=find('replies'),rows=observerProgressReplies(view,moment?.key);
 if(host){host.observerRows??=new Map();
  for(const row of rows){let nodes=host.observerRows.get(row.arm);
   if(!nodes){const article=doc.createElement('article'),title=doc.createElement('h3'),caption=doc.createElement('p'),body=doc.createElement('div');article.className='observer-reply observer-reply-'+row.arm;title.textContent=row.arm==='with'?'With Presence':'Without Presence';caption.className='observer-reply-caption';body.className='observer-reply-body';article.append(title,caption,body);host.append(article);nodes={article,caption,body,key:null};host.observerRows.set(row.arm,nodes);}
   const caption=row.text?row.caption:row.status;if(nodes.caption.textContent!==caption)nodes.caption.textContent=caption;
   const key=JSON.stringify([row.text,row.text?null:row.status]);
   if(nodes.key!==key){nodes.key=key;nodes.body.replaceChildren();if(row.text)nodes.body.append(renderMarkdown(doc,row.text));else{const p=doc.createElement('p');p.textContent=row.status==='not started'?'Send a task to begin.':'No final reply yet. '+row.status.replace(/^./,x=>x.toUpperCase())+'.';nodes.body.append(p);}}
  }
  if(!rows.length){host.replaceChildren();host.observerRows.clear();}
 }
}

export function renderObserverExperience(container,experience){
 const doc=container.ownerDocument,find=name=>container.querySelector('[data-observer-'+name+']');
 for(const name of ['paragraph','scope','source','link','models']){const node=find(name);if(node)node.textContent=experience[name];}
 const body=find('dimensions');if(body){body.replaceChildren();for(const row of experience.dimensions){
  const tr=doc.createElement('tr'),heading=doc.createElement('th');heading.scope='row';
  const title=doc.createElement('strong');title.textContent=row.title;const badge=doc.createElement('span');badge.className='observer-badge observer-'+row.status;badge.textContent=row.status==='self_reported'?'Self-reported':row.status==='observed'?'Observed':'Unverified';heading.append(title,badge);
  const summary=doc.createElement('p');summary.className='observer-summary';summary.textContent=row.summary;const limits=doc.createElement('details'),limitLabel=doc.createElement('summary'),detail=doc.createElement('p');limits.className='observer-row-limits';limitLabel.textContent='Scope & limits';detail.className='observer-detail';detail.textContent=row.detail;limits.append(limitLabel,detail);heading.append(summary,limits);tr.append(heading);
  for(const arm of ['without','with']){const td=doc.createElement('td');td.textContent=row[arm];tr.append(td);}body.append(tr);
 }}
 const quotes=find('excerpts');if(quotes){quotes.replaceChildren();const evidence=observerLocalEvidence(experience);
  if(!evidence.length){const p=doc.createElement('p');p.textContent='No completed response has sufficient local linkage for an excerpt. Missing evidence is not evidence of no change.';quotes.append(p);}
  for(const row of evidence){const figure=doc.createElement('figure'),caption=doc.createElement('figcaption'),quote=doc.createElement('blockquote');
   caption.textContent=`${row.arm==='with'?'With Presence':'Without'} · turn ${row.turn}, final ${row.final}`+(row.linkage==='request_linked'?` · request ${row.request}`:' · turn-scoped; provider response identity unverified');
   quote.textContent=row.excerpt.text;const offset=doc.createElement('p');offset.className='footnote';offset.textContent=`Exact excerpt · characters ${row.excerpt.start}–${row.excerpt.end}`+(row.read_id?` · read ${row.read_id}`:'')+(row.reading_id?` · reading ${row.reading_id}`:'');figure.append(caption,quote,offset);quotes.append(figure);
  }
 }
}

export function renderComparisonGraphic(host,record,{onEvidence=()=>{},sourceHost=null}={}){
 const doc=host.ownerDocument;host.replaceChildren();const report=record?.report;if(!report)return;
 if(report.schema_version===2){renderComparisonHighlights(host,record,{onEvidence,sourceHost});return;}
 if(!Array.isArray(report.lanes))return;
 const moments=presenceMomentView(record);
 if(moments.length){
  host.className='observer-moment-graphic';if(sourceHost)sourceHost.replaceChildren();
  const headings=doc.createElement('div');headings.className='observer-moment-columns';
  for(const arm of ['without','with']){const h=doc.createElement('h3');h.textContent=observerArmLabel(arm);headings.append(h);}host.append(headings);
  const sharedReference=moments.length>1&&moments.every(m=>!m.with_before&&!m.with_after&&m.with_context?.id===moments[0].with_context?.id&&m.baseline?.id===moments[0].baseline?.id);
  const excerpt=(parent,message,label)=>{const caption=doc.createElement('p'),quote=doc.createElement('blockquote');caption.className='observer-excerpt-label';caption.textContent=label+' · excerpt';quote.className='observer-moment-quote';const paragraphs=message?.text?.split(/\n\s*\n/).filter(p=>p.trim())??[],body=(paragraphs[0]?.trim().length>=190?paragraphs[0]:paragraphs.slice(1).find(p=>p.trim().length>=70))??paragraphs[0],text=body?.replace(/\s+/g,' ').trim()??'';quote.textContent=text?text.slice(0,190)+(text.length>190?'…':''):'No public completion saved.';parent.append(caption,quote);};
  for(const moment of moments){
   const row=doc.createElement('article'),heading=doc.createElement('header'),label=doc.createElement('strong'),change=doc.createElement('p'),reference=doc.createElement('p'),pair=doc.createElement('div'),baseline=doc.createElement('section'),adaptive=doc.createElement('section');
   row.className='observer-presence-moment';label.textContent=moment.label;change.className='observer-moment-change';change.textContent=presenceChangeLabel(moment.before,moment.after);reference.className='observer-moment-reference';reference.textContent=presenceMomentReference(moment);heading.append(label,change,reference);pair.className='observer-moment-pair';
   excerpt(baseline,moment.baseline,'Reference reply');
   if(moment.with_before&&moment.with_after&&moment.scope==='linked_reply_change'){excerpt(adaptive,moment.with_before,'Before');excerpt(adaptive,moment.with_after,'After');}
   else excerpt(adaptive,moment.with_after??moment.with_context,moment.with_after?'Reply under this guidance':'Saved completion');
   pair.append(baseline,adaptive);row.append(heading);if(!sharedReference||moment===moments.at(-1))row.append(pair);host.append(row);
   const refs=doc.createElement('button');refs.type='button';refs.className='observer-source-button';refs.textContent=moment.label;refs.addEventListener('click',()=>onEvidence([moment.id,moment.before_id,moment.after_id,moment.with_before_link_id,moment.with_after_link_id,moment.with_before_message_id,moment.with_after_message_id,moment.with_context_message_id,moment.baseline?.id].filter(Boolean)));if(sourceHost)sourceHost.append(refs);
  }
  return;
 }
 host.className='observer-work-lanes';
 const labels={what:'What',how:'How',when:'When',guidance:'Presence guidance',adaptation:'Replies',inputs:'Recorded inputs',exchange:'Replies',work:'Work'};
 if(sourceHost)sourceHost.replaceChildren();
 for(const arm of ['without','with']){const lane=report.lanes.find(x=>x.arm===arm);if(!lane)continue;const article=doc.createElement('article'),title=doc.createElement('h3'),stages=doc.createElement('ol');article.className='observer-work-lane observer-work-'+arm;title.textContent=observerArmLabel(arm);
  const kinds=lane.stages?.some(x=>x.kind==='what')?['what','how','when']:lane.stages?.some(x=>x.kind==='guidance')?['guidance','adaptation','work']:['inputs','exchange','work'];
  for(const kind of kinds){const row=lane.stages?.find(x=>x.kind===kind);if(!row)continue;const node=doc.createElement('li'),label=doc.createElement('strong'),text=doc.createElement('p'),refs=doc.createElement('button');label.textContent=labels[kind];text.textContent=row.text;refs.type='button';refs.className='observer-source-button';refs.textContent=sourceHost?observerArmLabel(arm)+' · '+labels[kind]:(row.evidence_ids?.length??0)+((row.evidence_ids?.length??0)===1?' source':' sources');refs.addEventListener('click',()=>onEvidence(row.evidence_ids??[]));node.append(label,text);if(sourceHost)sourceHost.append(refs);else node.append(refs);stages.append(node);}
  article.append(title,stages);host.append(article);
 }
}

export function renderComparisonSummary(host,control,text,{maxChars=240,maxWords=35,moreLabel='Read full assessment'}={}){
 if(!host)return;const value=typeof text==='string'?text:'',words=[...value.matchAll(/\S+/gu)],compact=!!control&&(value.length>maxChars||words.length>maxWords);
 const wordEnd=words[maxWords-1]?words[maxWords-1].index+words[maxWords-1][0].length:value.length,limit=Math.min(maxChars,wordEnd),prefix=value.slice(0,limit),sentence=prefix.match(/^[\s\S]*?[.!?](?=\s+[A-Z]|$)/u)?.[0];
 const fragment=prefix.slice(0,prefix.length<value.length&&/\S/u.test(value[prefix.length]??'')?(prefix.lastIndexOf(' ')>0?prefix.lastIndexOf(' '):prefix.length):prefix.length).trimEnd(),brief=sentence??fragment+'…';
 host.textContent=compact?brief:value;host.setAttribute('data-compact',String(compact));host.setAttribute('data-expanded','false');
 if(!control)return;control.hidden=!compact;control.textContent=moreLabel;control.setAttribute('aria-expanded','false');let expanded=false;
 control.onclick=()=>{expanded=!expanded;host.textContent=expanded?value:compact?brief:value;host.setAttribute('data-expanded',String(expanded));control.setAttribute('aria-expanded',String(expanded));control.textContent=expanded?'Show less':moreLabel;};
}

export function renderComparisonHighlights(host,record,{onEvidence=()=>{},sourceHost=null}={}){
 const doc=host.ownerDocument;host.replaceChildren();host.className='observer-highlights';if(sourceHost)sourceHost.replaceChildren();
 const categories={depth:'Density',interruptions:'Interruptions',turns:'Conversation',format:'Presentation',content:'Work'},order=Object.keys(categories),highlights=observerHighlightView(record).sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category));
 if(!highlights.length){const empty=doc.createElement('p');empty.className='observer-exchange-empty';empty.textContent='This export has no response excerpts.';host.append(empty);return;}
 const byCategory=new Map(highlights.map(h=>[h.category,h])),choices=order.filter(category=>category!=='content'||byCategory.has(category)),nav=doc.createElement('div'),pane=doc.createElement('div');nav.className='observer-highlight-picker';nav.setAttribute('role','group');nav.setAttribute('aria-label','Comparison focus');pane.className='observer-highlight-pane';host.append(nav,pane);
 const buttons=[];function select(index){
  buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));const highlight=byCategory.get(choices[index]),item=doc.createElement('article'),heading=doc.createElement('header'),title=doc.createElement('h3'),explanation=doc.createElement('div'),sentence=doc.createElement('p'),more=doc.createElement('button'),pair=doc.createElement('div');
  item.className='observer-highlight';heading.className='observer-highlight-heading';title.textContent=highlight.title;title.setAttribute('title',highlight.title);heading.append(title);explanation.className='observer-highlight-explanation';more.type='button';more.className='observer-text-action';renderComparisonSummary(sentence,more,highlight.explanation?.text??'',{maxChars:160,maxWords:22,moreLabel:'More'});explanation.append(sentence,more);pair.className='observer-highlight-excerpts';
  for(const arm of ['without','with']){
   const frame=highlight.frames[arm],card=doc.createElement('section'),bar=doc.createElement('header'),author=doc.createElement('strong'),context=doc.createElement('span'),body=doc.createElement('div');
   card.className='observer-terminal observer-terminal-'+arm+(frame.missing?' observer-terminal-missing':'');bar.className='observer-terminal-heading';author.textContent=observerArmLabel(arm);context.textContent=frame.turn?`Turn ${frame.turn} · ${frame.phase.toLowerCase()}`:frame.missing?'No corresponding turn':frame.phase==='Reply'?'Excerpt':frame.phase+' · excerpt';bar.append(author,context);body.className='session-entry-body';
   if(frame.missing){const p=doc.createElement('p');p.textContent='No corresponding response selected for this step.';body.append(p);}
   else if(frame.span.render_as==='code'){const pre=doc.createElement('pre'),code=doc.createElement('code');code.textContent=frame.span.text;pre.append(code);body.append(pre);}
   else body.append(renderMarkdown(doc,(frame.span.render_prefix??'')+frame.span.text));
   card.append(bar,body);pair.append(card);
  }
  item.append(heading,explanation,pair);pane.replaceChildren(item);
 }
 choices.forEach((category,index)=>{const button=doc.createElement('button');button.type='button';button.textContent=categories[category];button.disabled=!byCategory.has(category);if(button.disabled)button.setAttribute('title','Not covered by this saved assessment');else button.addEventListener('click',()=>select(index));buttons.push(button);nav.append(button);});
 highlights.forEach(highlight=>{
  if(sourceHost){const policy=doc.createElement('p');policy.className='observer-highlight-policy';policy.textContent=(categories[highlight.category]??'Comparison')+' · '+observerHighlightPolicy(record,highlight);sourceHost.append(policy);
   const ids=[...new Set([...(highlight.explanation?.evidence_ids??[]),...(highlight.policy_ids??[]),highlight.without?.message_id,highlight.with?.message_id].filter(id=>id&&id!=='none'))],source=doc.createElement('button');source.type='button';source.className='observer-source-button';source.textContent=categories[highlight.category]??highlight.title;source.addEventListener('click',()=>onEvidence(ids));sourceHost.append(source);
  }
 });select(choices.findIndex(category=>byCategory.has(category)));
}

export function renderComparisonResources(host,record,{detailHost=null}={}){
 const target=detailHost??host;if(!target)return;const doc=target.ownerDocument,view=observerSessionResources(record);if(host)host.replaceChildren();if(detailHost)detailHost.replaceChildren();
 if(!view.rows.some(row=>row.without!==null||row.with!==null))return;
 const number=n=>integer(n)?new Intl.NumberFormat('en-US').format(n):'—',table=doc.createElement('table'),caption=doc.createElement('caption'),head=doc.createElement('thead'),titles=doc.createElement('tr'),body=doc.createElement('tbody');table.className='observer-resource-comparison';caption.textContent='Coding-session totals';
 for(const label of ['',observerArmLabel('without'),observerArmLabel('with')]){const th=doc.createElement('th');th.textContent=label;th.setAttribute('scope','col');titles.append(th);}head.append(titles);
 for(const row of view.rows){const tr=doc.createElement('tr'),label=doc.createElement('th');label.textContent=row.label;label.setAttribute('scope','row');tr.append(label);for(const arm of ['without','with']){const cell=doc.createElement('td');cell.textContent=row.key==='elapsed_seconds'&&row[arm]!==null?row[arm].toFixed(1)+'s'+(row[arm+'_status']==='completed'?'':' · '+row[arm+'_status']):number(row[arm]);tr.append(cell);}body.append(tr);}
 table.append(caption,head,body);target.append(table);const note=doc.createElement('p');note.className='observer-resource-note';note.textContent='Input includes cache reads. Input minus cache reads is shown separately.';target.append(note);
}

// Plot the same saved evidence as the assessment, never current or observer usage.
export function renderComparisonUsageGraph(host,record){
 if(!host)return;host.replaceChildren();const doc=host.ownerDocument,view=observerSessionResources(record),keys=['completed_turns','model_calls','input_tokens','output_tokens','elapsed_seconds'],labels={completed_turns:'Completed turns',model_calls:'Model calls',input_tokens:'Input tokens',output_tokens:'Output tokens',elapsed_seconds:'Turn time'};
 const rows=keys.map(key=>{const row=view.rows.find(r=>r.key===key);return{...row,...(key==='elapsed_seconds'?Object.fromEntries(['without','with'].map(a=>[a,['completed','partial','running'].includes(row[a+'_status'])?row[a]:null])):{})};});
 host.hidden=!rows.some(r=>r.without!==null||r.with!==null);if(host.hidden)return;
 const caption=doc.createElement('figcaption'),title=doc.createElement('strong'),legend=doc.createElement('span'),plots=doc.createElement('div');title.textContent='Run usage';caption.className='observer-usage-caption';legend.className='observer-usage-legend';plots.className='observer-usage-plots';
 for(const arm of ['without','with']){const name=doc.createElement('span');name.className='observer-usage-'+arm;name.textContent=observerArmLabel(arm);legend.append(name);}caption.append(title,legend);host.append(caption,plots);let hasCache=false,unknownCache=false;
 for(const row of rows){const metric=doc.createElement('div'),label=doc.createElement('h4'),maximum=Math.max(row.without??0,row.with??0);metric.className='observer-usage-metric';metric.setAttribute('data-metric',row.key);label.textContent=labels[row.key];metric.append(label);
  for(const arm of ['without','with']){const value=row[arm],line=doc.createElement('div'),track=doc.createElement('span'),amount=doc.createElement('span');line.className='observer-usage-row observer-usage-'+arm;line.setAttribute('data-arm',arm);track.className='observer-usage-track';track.setAttribute('aria-hidden','true');amount.className='observer-usage-value';amount.textContent=value===null?'—':row.key==='elapsed_seconds'?value.toFixed(1)+'s'+(row[arm+'_status']==='completed'?'':' · '+row[arm+'_status']):new Intl.NumberFormat('en-US').format(value);let description=observerArmLabel(arm)+': '+(value===null?'not recorded':amount.textContent)+' '+labels[row.key];
   if(value===null)track.setAttribute('data-missing','true');else{const fill=doc.createElement('span');fill.className='observer-usage-fill';fill.setAttribute('style','width:'+(maximum?100*(value/maximum):0)+'%');track.append(fill);
    const cache=view.arms[arm].cache_read_tokens;if(row.key==='input_tokens'){if(view.arms[arm].cache_consistent===true){description+='; '+new Intl.NumberFormat('en-US').format(cache)+' cache-read tokens';if(cache>0){hasCache=true;const cached=doc.createElement('span');cached.className='observer-usage-cache';cached.setAttribute('style','width:'+(value?100*(cache/value):0)+'%');fill.append(cached);}}else{unknownCache=true;fill.setAttribute('data-cache-unknown','true');amount.textContent+='*';description+=view.arms[arm].cache_consistent===false?'; cache counts inconsistent; split unavailable':'; cache breakdown not recorded';}}
   }line.setAttribute('aria-label',description);line.setAttribute('title',description);line.append(track,amount);metric.append(line);
  }plots.append(metric);
 }const note=doc.createElement('p');note.className='observer-usage-note';note.textContent='Each metric has its own scale.'+(hasCache?' Hatched input is cache reads.':'')+(unknownCache?' * Cache split unavailable.':'');host.append(note);
}
// These are recorded controls/link counts, not a local inference of benefit.
export function comparisonGuidanceView(record){
 const evidence=record?.evidence??[],rows=evidence.filter(e=>e.kind==='presence_request'&&e.arm==='with').sort((a,b)=>(a.turn_ordinal??0)-(b.turn_ordinal??0)||(a.ordinal??0)-(b.ordinal??0));
 const changes=[];let previous='';
 for(const row of rows){const c=row.controls,key=row.status==='fallback_observed'?'fallback':row.status==='guidance_observed'&&c?JSON.stringify(c):null;if(!key)continue;if(key===previous)continue;previous=key;changes.push(row);}
 const recent=changes.slice(-3),label=row=>row.status==='fallback_observed'?'ordinary fallback':({terse:'brief replies',standard:'standard detail',full:'fuller replies'}[row.controls.response_extent]??'unknown detail')+', '+(row.controls.unsolicited_update==='defer'?'updates deferred':'updates allowed')+', '+(row.controls.conversation_style==='self_contained'?'self-contained':'conversational');
 const coverage=record?.coverage,requests=coverage?.requests?.with,history=coverage?.history,missing=v=>v==null||v>0,partial=!coverage||missing(requests?.omitted)||missing(requests?.source_omitted)||missing(history?.turn_records?.omitted)||missing(history?.arms?.with?.turns_omitted);
 const text=recent.length?(partial?'Partial recorded guidance history · ':'')+(changes.length>3?'Earlier changes omitted here. ':'')+recent.map(label).join(' → '):'No delivered request-time guidance is available.';
 const linked=evidence.filter(e=>e.kind==='completion_link'&&e.arm==='with'&&e.status==='request_linked'&&evidence.some(r=>r.id===e.request_id)&&evidence.some(m=>m.id===e.message_id));
 const note=(linked.length?'Linked public-reply evidence is available.':'This snapshot does not map each reply to its Presence request. The exchanges and work can still be compared.')+' The record covers captured public turns, rather than the complete provider context.';
 return{text,note,partial,linked_replies:linked.length,evidence_ids:recent.map(r=>r.id)};
}
// Deterministic source receipts are separate from every model-authored claim.
export function renderRecordedActions(host,record){
 if(!host)return;host.replaceChildren();
 const facts=record?.recorded_facts,packet=record?.input_packet;
 if(facts?.source!=='comparison_input_receipts'||packet?.fingerprint!==record?.fingerprint||!Array.isArray(facts.evidence)){host.textContent='Recorded action counters were not retained for this assessment.';return;}
 const doc=host.ownerDocument,table=doc.createElement('table'),caption=doc.createElement('caption'),head=doc.createElement('tr');caption.textContent='Recorded per-arm receipts';table.append(caption);
 for(const text of ['Actor','Action','Without Presence','With Presence']){const cell=doc.createElement('th');cell.textContent=text;head.append(cell);}table.append(head);
 const number=x=>Number.isSafeInteger(x)&&x>=0?new Intl.NumberFormat('en-US').format(x):'Unknown';
 for(const actor of ['participant','coordinator','unattributed'])for(const [field,label]of [['steering_accepted','Accepted steering'],['interrupt_accepted','Accepted interrupt'],['interrupt_unconfirmed','Unconfirmed interrupt']]){
  const row=doc.createElement('tr');for(const text of [actor[0].toUpperCase()+actor.slice(1),label]){const cell=doc.createElement('td');cell.textContent=text;row.append(cell);}
  for(const arm of ['without','with']){const fact=facts.evidence.find(x=>x.kind==='interaction'&&x.arm===arm&&x.id==='interactions.'+arm),cell=doc.createElement('td');cell.textContent=fact?.available?.turn_actions===true?number(fact?.actors?.[actor]?.[field]):'Unknown';row.append(cell);}table.append(row);
 }
 host.append(table);const note=doc.createElement('p');note.className='footnote';note.textContent='Per-arm receipts are not additive counts of unique user actions.';host.append(note);
}

export function mountComparisonReport(container,{post,onState,beforeAssess=async()=>{},enabled=false}={}){
 const find=name=>container.querySelector('[data-comparison-'+name+']'),panel=find('panel');if(!panel)return{render(){}};panel.hidden=!enabled;
 const prepare=find('prepare'),status=find('status');let current=null,connected=false,pending=false,generation=null,message='',last='';
 const ready=s=>['without','with'].some(a=>(s?.arms?.[a]?.messages??[]).length>0||s?.arms?.[a]?.delivery?.turn_ordinal>0||s?.arms?.[a]?.usage?.model_calls>0)&&['ready','closed'].includes(s?.status)&&!s.code_checks?.running&&['without','with'].every(a=>['ready','closed','failed'].includes(s.arms?.[a]?.status)&&!(s.arms[a].approvals??[]).length&&!(s.arms[a].questions??[]).length&&!s.arms[a].active_turn_id);
 const number=x=>integer(x)?new Intl.NumberFormat('en-US').format(x):'—';
 function render(state,options={}){
  current=state;connected=options.connected===true;if(!enabled)return;if(generation!==state?.session_generation){generation=state?.session_generation;message='';last='';}
  const comparison=state?.muse_comparison,record=comparison?.reports?.at(-1),running=comparison?.status==='running';prepare.disabled=!connected||pending||running||!ready(state);
  prepare.textContent=record?.stale?'Update Presence impact':'See Presence impact';
  status.textContent=message||(!connected?'Disconnected; showing the last assessment.':running?'Muse is comparing the experience and resource use…':record?.status==='failed'?'Assessment unavailable. No report was published; no retry was made.'+(record.stale?' This attempt covers earlier work.':''):record?.status==='cancelled'?'Assessment cancelled.'+(record.stale?' This attempt covers earlier work.':''):record?.stale?'Earlier assessment · the tasks have progressed.':record?.status==='completed'?'Assessment ready.':!ready(state)?'Available when the tasks settle.':'Compare what changed, how it changed, and when.');
  const key=JSON.stringify(record);if(key===last)return;last=key;renderRecordedActions(find('recorded-action-table'),record);find('audit').hidden=!record;const u=record?.usage;find('usage').textContent=record?'Report only: '+number(u?.model_calls)+' calls · '+number(u?.input_tokens)+' input / '+number(u?.output_tokens)+' output tokens · '+(integer(u?.elapsed_ms)?(u.elapsed_ms/1000).toFixed(1)+'s':'—')+' · cost unavailable. Snapshot '+record.fingerprint:'';find('diagnostics').textContent=record?.diagnostics?JSON.stringify(record.diagnostics,null,2):'';find('coverage').textContent=record?.coverage?JSON.stringify(record.coverage,null,2):'Earlier report: packet coverage was not retained.';find('sources').textContent=record?.report?'Select a source count in the graphic to inspect the recorded evidence.':'No validated report or source interpretation was published.';find('result').hidden=record?.status!=='completed'||!record?.report;if(!record?.report)return;
  find('at').textContent='Muse summary · '+new Date(record.at).toLocaleTimeString('en-GB',{hourCycle:'h23'})+(record.stale?' · earlier work':'');
  find('context').textContent=record.input_relation==='different_observed_sequence'?'Different recorded inputs · work is compared against each arm’s instructions.':record.input_relation==='same_observed_sequence'?'Same recorded input sequence.':'Input coverage is incomplete.';
  const showSources=ids=>{find('sources').textContent=JSON.stringify((record.evidence??[]).filter(x=>ids.includes(x.id)),null,2);find('evidence').open=true;};
  find('all-sources').onclick=()=>showSources((record.evidence??[]).map(e=>e.id));
  renderComparisonGraphic(find('graphic'),record,{onEvidence:showSources,sourceHost:find('node-sources')});renderComparisonSummary(find('paragraph'),find('paragraph-more'),(record.report.schema_version===2?record.report.overall?.text:record.report.paragraph?.text)??'');renderComparisonUsageGraph(find('usage-graph'),record);renderComparisonResources(find('resource-summary'),record,{detailHost:find('session-resources')});
  const guidance=comparisonGuidanceView(record),assessment=record.report.presence?.assessment,labels={aligned:'Reply aligns with guidance',no_clear_change:'No clear reply change',mixed:'Mixed response to guidance',possible_tradeoff:'Possible tradeoff',unverified:guidance.linked_replies?'Reply alignment not determined':'Reply link not recorded'};
  find('observed').textContent=guidance.text;find('linkage').textContent=guidance.note;find('guidance-sources').onclick=()=>showSources(guidance.evidence_ids);find('verdict').textContent=labels[assessment]??'';find('verdict').hidden=assessment==='unverified'||!assessment;find('verdict').className='observer-assessment observer-assessment-'+(Object.hasOwn(labels,assessment)?assessment:'unverified');find('presence').textContent=record.report.presence?.text??'';find('presence-sources').onclick=()=>showSources(record.report.schema_version===2?record.report.highlights.flatMap(h=>h.policy_ids):record.report.presence?.evidence_ids??[]);find('paragraph-sources').onclick=()=>showSources(record.report.schema_version===2?record.report.overall?.evidence_ids??[]:record.report.paragraph?.evidence_ids??[]);
  find('sources').textContent='Choose a highlight or assessment above to inspect its recorded evidence.';
 }
 prepare.addEventListener('click',async()=>{if(prepare.disabled)return;const requestedGeneration=generation;pending=true;let dispatched=false;message='Preparing the comparison…';render(current,{connected});try{await beforeAssess();if(generation!==requestedGeneration||!connected)throw Error('comparison_changed');const prepared=await post('observer/report/preview',{generation:requestedGeneration});if(generation!==requestedGeneration||!connected)throw Error('comparison_changed');onState(prepared.state);if(generation!==requestedGeneration||!connected||!ready(current))throw Error('comparison_changed');message='';dispatched=true;const result=await post('observer/report',{generation:requestedGeneration,preview_id:prepared.preview.id});onState(result.state);}catch{message=dispatched?'The assessment could not be confirmed. Check its status before requesting another.':'The comparison changed before it could be assessed. Request it when the tasks settle.';}finally{pending=false;render(current,{connected});}});
 return{render};
}

export function mountPresenceObserver(container,{readMetrics,readPresentation=()=>undefined,post,onState,enabled=false,recordingEnabled=false,reportEnabled=false}={}){
 if(!container)return null;
 placeObserverLayout(container);
 const reportPanel=mountComparisonReport(container,{post,onState,enabled:reportEnabled,beforeAssess:async()=>{if(recordingEnabled){sync.observe(projectMechanismMetrics(readMetrics()),current?.session_generation,readPresentation());await sync.flush();}}});
 const subtitle=container.querySelector('.observer-subtitle');if(reportEnabled&&subtitle)subtitle.hidden=true;
 const liveEvidence=container.querySelector('[data-observer-live]');if(liveEvidence){liveEvidence.open=!reportEnabled;liveEvidence.hidden=reportEnabled;}
 const legacyEvidence=container.querySelector('[data-observer-telemetry]');if(legacyEvidence)legacyEvidence.hidden=reportEnabled;
 const progress=createObserverProgress();let progressView=null,selectedMoment=null,lastLatest=null,progressGeneration=null;
 const selectMoment=key=>{selectedMoment=key;if(progressView)renderObserverProgress(container,progressView,{selected:selectedMoment,onSelect:selectMoment});};
 const doc=container.ownerDocument,tracker=container.querySelector('[data-observer-tracker]'),button=container.querySelector('[data-observer-explain]'),status=container.querySelector('[data-observer-status]'),time=container.querySelector('[data-observer-time]'),facts=container.querySelector('[data-observer-facts]'),usage=container.querySelector('[data-observer-usage]');
 if(reportEnabled)button.disabled=true;
 const decisions=container.querySelector('[data-observer-decisions]');
 const sync=createMechanismSync({send:body=>post('observer/metrics',body)});let current=null,connected=false,pending=false,message='',lastReport='',lastDecisions='',lastExperience='';
 container.hidden=!recordingEnabled&&!enabled&&!reportEnabled;
 const ready=s=>['ready','closed'].includes(s?.status)&&['without','with'].every(a=>['ready','closed','failed'].includes(s.arms?.[a]?.status)&&(s.arms[a].approvals??[]).length===0);
 function render(state,options={}){
  reportPanel.render(state,options);
  if(reportEnabled){current=state;connected=options.connected===true;sync.setConnected(connected);if(recordingEnabled)sync.observe(projectMechanismMetrics(readMetrics()),state?.session_generation,readPresentation());return;}
  if(state?.session_generation!==current?.session_generation)message='';
  if(state?.session_generation!==progressGeneration){progressGeneration=state?.session_generation;selectedMoment=null;lastLatest=null;}
  progressView=progress.observe(state);if(!selectedMoment || selectedMoment===lastLatest || !progressView.moments.some(x=>x.key===selectedMoment))selectedMoment=progressView.latest_key;lastLatest=progressView.latest_key;renderObserverProgress(container,progressView,{selected:selectedMoment,onSelect:selectMoment});
  current=state;connected=options.connected===true;const metrics=projectMechanismMetrics(readMetrics());
  const presentation=readPresentation();sync.setConnected(connected);if(recordingEnabled)sync.observe(metrics,state?.session_generation,presentation);
  if(decisions){const lines=presentationDecisionLines(presentation,state?.session_generation),key=JSON.stringify(lines);if(key!==lastDecisions){lastDecisions=key;decisions.replaceChildren();for(const line of lines){const item=doc.createElement('li');item.textContent=line;decisions.append(item);}}}
  tracker.textContent=metrics?`This view: ${metrics.held_current} held · ${metrics.released_manual} shown manually · ${metrics.released_automatic} released automatically`+(metrics.coverage==='partial'?' · partial history':''):'Update counts unavailable for this view.';
  const experience=buildObserverExperience(state,{metrics}),experienceKey=JSON.stringify(experience)+JSON.stringify(observerLocalEvidence(experience));if(experienceKey!==lastExperience){lastExperience=experienceKey;renderObserverExperience(container,experience);}
  const observer=state?.presence_observer,report=observer?.reports?.at(-1),running=observer?.status==='running';
  button.disabled=!enabled||!connected||pending||running||!ready(state)||!metrics;
  status.textContent=message||(!connected?'Disconnected; showing the last received evidence snapshot.':running?'Muse is reviewing the evidence…':sync.status()==='failed'?'Update counts not saved.':!enabled?'Muse explanation unavailable.':'');
  const stale=report&&(['without','with'].some(a=>report.evidence_scope?.[a+'_turn']!==(integer(state?.arms?.[a]?.delivery?.turn_ordinal)&&state.arms[a].delivery.turn_ordinal>0?state.arms[a].delivery.turn_ordinal:null)) || !ready(state));
  const reportKey=JSON.stringify([report,stale]);if(reportKey!==lastReport){lastReport=reportKey;facts.replaceChildren();time.textContent='';usage.textContent='';const highlights=container.querySelector('[data-observer-highlight]'),snapshot=container.querySelector('[data-observer-report]'),snapshotParagraph=container.querySelector('[data-observer-report-paragraph]');if(highlights)highlights.textContent='';if(snapshot)snapshot.hidden=true;if(snapshotParagraph)snapshotParagraph.textContent='';if(report){
   time.textContent='Muse evidence snapshot · '+new Date(report.at).toLocaleTimeString('en-GB',{hourCycle:'h23'})+(stale?' · earlier turn; current evidence is shown above':' · independent observer');
   if(report.status==='completed'){
    if(snapshot)snapshot.hidden=false;
    if(snapshotParagraph)snapshotParagraph.textContent=report.experience?.paragraph??'Historical observer report: only the original validated facts were retained.';
    const dimensions=(report.fact_ids??[]).filter(id=>id.startsWith('dimension_')).map(id=>id.slice(10));
    if(highlights)highlights.textContent=dimensions.length?'Muse highlighted '+dimensions.join(', ')+'. This is model-interpreted relevance, not verified adaptation.':'Muse selected supporting observations; no response adaptation was verified.';
    for(const sentence of report.sentences??[]){const item=doc.createElement('li');item.textContent=sentence;facts.append(item);}
   }else if(highlights)highlights.textContent=report.status==='cancelled'?'Muse observer cancelled. Current local observations remain available.':'No Muse explanation was verified. Current local observations remain available.';
   const u=report.usage,number=x=>integer(x)?new Intl.NumberFormat('en-US').format(x):'—';usage.textContent=`Observer only: ${number(u?.model_calls)} calls · ${number(u?.input_tokens)} input / ${number(u?.output_tokens)} output tokens · ${integer(u?.elapsed_ms)?(u.elapsed_ms/1000).toFixed(1)+'s':'—'} · cost unavailable`;
  }}
 }
 button.addEventListener('click',async()=>{
  if(button.disabled)return;pending=true;message='Saving the evidence snapshot…';render(current,{connected});const generation=current.session_generation;
  try{await sync.flush();if(current?.session_generation!==generation||!connected)throw Error('observer_session_changed');const result=await post('observer/explain',{generation,ledger_id:sync.id});message='';onState(result.state);}
  catch{message='Observer request could not be confirmed. Check its status before trying again.';}
  finally{pending=false;render(current,{connected});}
 });
 return{render,close(){sync.close();}};
}

const ledgerId = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const phases = new Set(['start','end','sample','queued','replaced','dispatch','outcome']);
const reasons = new Set(['send','enter','blur','window_blur','visibility','stop','discarded','discontinuity','connection_lost','session_ended','revoked','page_closed','checkpoint']);
const outcomes = new Set(['completed','partial','empty','incomplete','discarded','ready','backoff','access_rejected','unavailable','observation_expired','unconfirmed','expired','cancelled','cancel_requested','unchanged','pool_exhausted','captured','unchanged_skipped','accepted','duplicate']);
export function projectWindowEvents(value, generation) {
 if(!ledgerId(value?.ledger_id)||!integer(generation)||generation<1||value.session_generation!==generation||!Array.isArray(value.events)||!integer(value.events_omitted))return null;
 let rejected=0;const events=[];
 for(const row of value.events.slice(-200)){
  if(!row||!integer(row.window_id)||row.window_id<1||!phases.has(row.phase)){rejected++;continue;}
  if(row.at_ms!==null&&(!integer(row.at_ms)||!Number.isFinite(new Date(row.at_ms).getTime()))){rejected++;continue;}
  if(row.reason!=null&&!reasons.has(row.reason)||row.status!=null&&!outcomes.has(row.status)){rejected++;continue;}
  const sampleId=integer(row.sample_id)&&row.sample_id>0?row.sample_id:null;
  events.push({window_id:row.window_id,sample_id:sampleId,sample_kind:['interim','final'].includes(row.sample_kind)?row.sample_kind:null,
   phase:row.phase,at_ms:row.at_ms,reason:row.reason??null,status:row.status??null});
 }
 const omitted=value.events_omitted+Math.max(0,value.events.length-200);
 if(!integer(omitted))return null;
 return{schema_version:1,source:'current_browser_tab',ledger_id:value.ledger_id,session_generation:generation,events,events_omitted:omitted,rejected_events:rejected};
}

// Only projected event metadata leaves the page. Posts are serialized and
// coalesced; acknowledgements mean the local evidence store flushed the snapshot.
export function createCaptureEventSync({send,onChange=()=>{}}={}){
 if(typeof send!=='function'||typeof onChange!=='function')throw Error('capture_sync_invalid');
 let connected=false,closed=false,pending=null,inFlight=null,state='waiting',incomplete=false;
 const acknowledged=new Map();
 const report=value=>{state=value;try{onChange(value);}catch{}};
 const keyOf=entry=>entry.session_generation+':'+entry.ledger_id;
 const totalOf=entry=>entry.events_omitted+entry.events.length;
 const deliver=entry=>send({generation:entry.session_generation,ledger:entry},{keepalive:true});
 function pump(){
  if(closed||!connected||inFlight||!pending)return;
  const entry=pending;pending=null;inFlight=entry;report('saving');let request;
  try{request=deliver(entry);}catch{request=Promise.reject(Error('capture_log_send_failed'));}
  Promise.resolve(request).then(result=>{
   if(!result||result.ok!==true||!Number.isSafeInteger(result.accepted_total)||result.accepted_total<totalOf(entry))throw Error('capture_log_unconfirmed');
   acknowledged.set(keyOf(entry),Math.max(acknowledged.get(keyOf(entry))??0,result.accepted_total));
   if(acknowledged.size>16)acknowledged.delete(acknowledged.keys().next().value);
   inFlight=null;if(closed)return;if(pending)pump();else report(incomplete?'incomplete':'saved');
  }).catch(error=>{
   inFlight=null;if(closed)return;if(error?.message==='capture_ledger_capacity'){const other=!!pending&&keyOf(pending)!==keyOf(entry);if(other){incomplete=true;report('capacity');if(connected)pump();}else{pending=null;report('capacity');}return;}
   const newer=!!pending&&(keyOf(pending)!==keyOf(entry)||totalOf(pending)>totalOf(entry));
   if(!pending)pending=entry;else if(keyOf(pending)!==keyOf(entry))incomplete=true;
   report('failed');if(newer&&connected)pump();
  });
 }
 function observe(raw){
  if(closed)return;
  const entry=projectWindowEvents(raw,raw?.session_generation);
  if(!entry||entry.rejected_events!==0||!Number.isSafeInteger(entry?totalOf(entry):NaN)){if(Array.isArray(raw?.events)&&raw.events.length){incomplete=true;report('failed');}return;}if(!entry.events.length)return;
  const key=keyOf(entry),total=totalOf(entry);
  if((acknowledged.get(key)??0)>=total)return;
  if(inFlight&&keyOf(inFlight)===key&&totalOf(inFlight)>=total&&!pending)return;
  if(pending){if(keyOf(pending)===key&&totalOf(pending)>=total){if(connected&&!inFlight&&state==='failed')pump();return;}if(keyOf(pending)!==key)incomplete=true;}
  pending=entry;if(!connected){report('offline');return;}if(!inFlight)pump();
 }
 return{observe,setConnected(value){const next=value===true;if(closed||connected===next)return;connected=next;if(!connected){if(pending||inFlight)report('offline');return;}pump();},status:()=>state,close(raw){
  if(closed)return;observe(raw);
  // If another snapshot is in flight, issue the newest one as an independent
  // best-effort keepalive; server monotonicity makes duplicate/out-of-order safe.
  if(connected&&inFlight&&pending){try{Promise.resolve(deliver(pending)).catch(()=>{});}catch{}}
  closed=true;
 }};
}

export function attachWindowEvents(report, events) {
 const ledger=projectWindowEvents(events,report?.session_generation);
 return ledger?{...report,browser_capture:{...ledger,persistence:'download_only'}}:report;
}

export function mountWindowEvents(container,{readEvents,readPersistence=()=>null}={}){
 if(!container||typeof readEvents!=='function')return null;
 const summary=container.querySelector('[data-window-summary]'),body=container.querySelector('[data-window-events]');
 if(!summary||!body)return null;
 let previous='';
 const phaseLabels={start:'Typing started',end:'Window ended',sample:'Snapshot',queued:'Waiting',replaced:'Replaced by newer input',dispatch:'Submitted to local broker',outcome:'Request result'};
 const statusLabels={completed:'Complete',partial:'Completed pairs retained',empty:'No typing',incomplete:'Incomplete input discarded',discarded:'Discarded',ready:'Usable response; reading change unconfirmed',accepted:'New reading accepted',duplicate:'Duplicate reading',backoff:'Rate limited',access_rejected:'Access rejected',unavailable:'Unavailable',observation_expired:'Observation expired',unconfirmed:'Outcome unconfirmed',expired:'Waiting sample expired',cancelled:'Cancelled before send',cancel_requested:'Cancelled locally; remote outcome unknown',unchanged:'Unchanged final skipped',pool_exhausted:'Interim slots used',captured:'Captured',unchanged_skipped:'No new input; not sent'};
 return{render(state){
  const ledger=projectWindowEvents(readEvents(),state?.session_generation),persistence=readPersistence(),key=JSON.stringify([ledger,persistence]);if(key===previous)return;previous=key;body.replaceChildren();
  const labels={waiting:'Waiting to save',saving:'Saving locally',saved:'Saved locally',failed:'Not saved',offline:'Waiting for connection',incomplete:'Some events not saved',capacity:'Log limit reached; new events not saved'};const persistenceLabel=Object.hasOwn(labels,persistence)?' · '+labels[persistence]:persistence==='unsupported'?' · This tab only':'';
  const rows=ledger?.events??[];
  if(!rows.length){const row=container.ownerDocument.createElement('tr'),cell=container.ownerDocument.createElement('td');cell.colSpan=4;cell.textContent='No capture events in this tab.';row.append(cell);body.append(row);summary.textContent='This tab'+persistenceLabel;return;}
  const latest=rows.at(-1);summary.textContent=`Window ${latest.window_id} · ${phaseLabels[latest.phase]}`+(ledger.events_omitted?` · ${ledger.events_omitted} earlier events omitted`:'')+persistenceLabel;
  for(const item of rows){
   const row=container.ownerDocument.createElement('tr'),stamp=item.at_ms===null?'—':new Date(item.at_ms).toLocaleTimeString('en-GB',{hourCycle:'h23'});
   const cells=[stamp,`Window ${item.window_id}`+(item.sample_id?` · sample ${item.sample_id}`:''),(item.sample_kind?item.sample_kind+' · ':'')+phaseLabels[item.phase],item.status?statusLabels[item.status]:item.reason?.replaceAll('_',' ')??'—'];
   for(const text of cells){const cell=container.ownerDocument.createElement('td');cell.textContent=text;row.append(cell);}body.append(row);
  }
 }};
}

export function sessionEvidenceHtml({includeExport=true}={}){return '<section id="session-evidence" aria-label="Saved comparison evidence"><p id="evidence-save-status" class="footnote" role="status">Evidence capture has not started.</p>'+(includeExport?'<button id="evidence-export" class="secondary" type="button" disabled>Export evidence</button>':'')+'<p id="evidence-export-status" class="footnote" role="status"></p>'+(includeExport?'<p class="footnote">Local JSON contains comparison metrics and policy/delivery evidence. Messages, typing, capsule bodies and credentials are excluded.</p>':'')+'</section>';}

export function evidenceView(state,{connected=false,pending=false}={}){
 const evidence=state?.evidence;
 let label={saving:'Saving evidence automatically…',saved:'Evidence saved automatically.',unavailable:'Evidence could not be saved. This run may be incomplete.',not_started:'Evidence capture has not started.',disabled:'Evidence capture is disabled for this workspace.'}[evidence?.status]??'Evidence status is unavailable.';
 if(evidence?.status==='saved'){
  const stamp=Date.parse(evidence.last_saved_at);
  if(Number.isFinite(stamp))label='Evidence saved automatically at '+new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(stamp)+'.';
 }
 if(!connected)label+=' Reconnect to export the saved snapshot.';
 const enabled=connected&&!pending&&integer(state?.session_generation)&&state.session_generation>0&&runId(evidence?.run_id)&&integer(evidence?.revision)&&['saved','saving'].includes(evidence?.status);
 return {label,enabled};
}

function browserDownload(report,filename){
 const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
 try{anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();}
 finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}

export function mountSessionEvidence(container,{fetchExport,download=browserDownload,readWindowEvents=()=>null}){
 if(!container||typeof fetchExport!=='function'||typeof download!=='function')throw Error('evidence_ui_invalid');
 const status=container.querySelector('#evidence-save-status'),button=container.querySelector('#evidence-export'),message=container.querySelector('#evidence-export-status');
 if(!status||!message)throw Error('evidence_ui_invalid');
 let current=null,connected=false,pending=false;
 const identity=state=>JSON.stringify([state?.session_generation,state?.evidence?.run_id]);
 function render(state,options={}){
  if(identity(state)!==identity(current))message.textContent='';
  current=state;connected=options.connected===true;
  const view=evidenceView(state,{connected,pending});status.textContent=view.label;if(button)button.disabled=!view.enabled;
 }
 button?.addEventListener('click',async()=>{
  if(button.disabled||pending)return;
  const selected={generation:current.session_generation,run:current.evidence.run_id,revision:current.evidence.revision};
  pending=true;message.textContent='Preparing evidence export…';render(current,{connected});
  try{
   const report=await fetchExport(selected.generation);
   if(current?.session_generation!==selected.generation||current?.evidence?.run_id!==selected.run){message.textContent='The session changed. Export again for the current pair.';return;}
   if(!connected){message.textContent='The connection changed. Reconnect before exporting.';return;}
   if(!['saved','saving'].includes(current.evidence?.status))throw Error('evidence_save_unavailable');
   if(report?.schema_version!==1||report.run_id!==selected.run||report.session_generation!==selected.generation||!integer(report.revision)||report.revision<selected.revision)throw Error('evidence_export_invalid');
   await download(attachWindowEvents(report,readWindowEvents()),'presence-comparison-'+selected.run+'.json');
   message.textContent=current?.session_generation!==selected.generation||current?.evidence?.run_id!==selected.run?'The earlier pair’s export was prepared; the current pair is different.':integer(current.evidence.revision)&&current.evidence.revision>report.revision?'An earlier evidence snapshot was prepared; newer evidence is available.':'Evidence JSON prepared for download.';
  }catch{message.textContent='Evidence export could not be confirmed. Check the saved status before trying again.';}
  finally{pending=false;render(current,{connected});}
 });
 return {render};
}

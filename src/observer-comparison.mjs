/**
 * Structural observer comparison for Presence responses.
 *
 * This module describes only countable Markdown/navigation structure.
 * It makes no claims about semantic depth, helpfulness, personal state,
 * causal adaptation, conversation quality, or human benefit.
 *
 * Legacy excerpts returned by observerExcerpt are local UI data only.
 * Report helpers at the end of this module resolve already-authorized packet
 * quotes back to their exact public source spans. Their Markdown is rendered
 * by the terminal's inert DOM renderer, never interpreted as HTML.
 */

const MAX_RESPONSE_CHARS = 24000;
const MAX_EXCERPT_CHARS = 400;
const DEFAULT_EXCERPT_CHARS = 240;

const COUNT_FIELDS = [
  'headings',
  'ordered_items',
  'bullet_items',
  'code_blocks',
  'diagram_blocks',
  'callout_lines',
  'table_rows',
  'paragraphs',
  'emphasis_spans',
  'question_marks',
];

function unavailableDescriptor() {
  return { status: 'unavailable' };
}

function isValidResponseText(text) {
  return (
    typeof text === 'string' &&
    text.trim().length > 0 &&
    text.length <= MAX_RESPONSE_CHARS
  );
}

function removeInlineCode(text) {
  return text.replace(/(`+)([\s\S]*?)\1/g, ' ');
}

function countBoldSpans(text) {
  let count = 0;
  let index = 0;

  while (index < text.length) {
    const asteriskIndex = text.indexOf('**', index);
    const underscoreIndex = text.indexOf('__', index);
    let marker = null;
    let start = -1;

    if (asteriskIndex !== -1 && (underscoreIndex === -1 || asteriskIndex < underscoreIndex)) {
      marker = '**';
      start = asteriskIndex;
    } else if (underscoreIndex !== -1) {
      marker = '__';
      start = underscoreIndex;
    } else {
      break;
    }

    const closing = text.indexOf(marker, start + marker.length);
    if (closing === -1) {
      break;
    }
    if (closing === start + marker.length) {
      index = start + marker.length;
      continue;
    }

    count += 1;
    index = closing + marker.length;
  }

  return count;
}

// A pipe alone is ordinary prose. Count table data/header rows only when an
// adjacent Markdown delimiter row establishes the table, excluding that row.
const tableRowCache = new WeakMap();
function tableCells(line) {
  if (typeof line !== 'string' || !line.includes('|')) return null;
  const cells=[];let cell='',fence=0;
  for(let i=0;i<line.length;i++) {
    if(line[i]==='\\' && line[i+1]==='|'){cell+='|';i++;continue;}
    if(line[i]==='`'){let end=i+1;while(line[end]==='`')end++;const size=end-i;cell+=line.slice(i,end);if(!fence)fence=size;else if(fence===size)fence=0;i=end-1;continue;}
    if(line[i]==='|' && !fence){cells.push(cell.trim());cell='';}else cell+=line[i];
  }
  cells.push(cell.trim());if(cells[0]==='')cells.shift();if(cells.at(-1)==='')cells.pop();return cells;
}
function tableMetadata(lines) {
  let result=tableRowCache.get(lines);if(result)return result;
  result={rows:new Set(),separators:new Set()};
  // Fence masking prevents delimiter-looking source code from qualifying a
  // neighboring prose line as a rendered table.
  let mark=null;
  const prose=lines.map(line=>{
    const f=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if(mark){if(f && f[1][0]===mark[0] && f[1].length>=mark.length && line.slice(f[0].length).trim()==='')mark=null;return null;}
    if(f){mark=f[1];return null;}return line;
  });
  for(let index=0;index<prose.length-1;index++) {
    const header=tableCells(prose[index]),rule=tableCells(prose[index+1]);
    if(!header || header.length<2 || header.length>16 || rule?.length!==header.length || !rule.every(cell=>/^:?-{3,}:?$/.test(cell)))continue;
    result.rows.add(index);result.separators.add(++index);
    while(index+1<prose.length && prose[index+1]?.trim() && tableCells(prose[index+1])?.length===header.length)result.rows.add(++index);
  }
  tableRowCache.set(lines,result);return result;
}
function isTableRow(index,lines) { return tableMetadata(lines).rows.has(index); }

export function describeObserverResponse(text) {
  if (!isValidResponseText(text)) {
    return unavailableDescriptor();
  }

  const counts = {
    headings: 0,
    ordered_items: 0,
    bullet_items: 0,
    code_blocks: 0,
    diagram_blocks: 0,
    callout_lines: 0,
    table_rows: 0,
    paragraphs: 0,
    emphasis_spans: 0,
    question_marks: 0,
  };

  const outsideFenceLines = [];
  const lines = text.split(/\r\n|\r|\n/);

  let inFence = false;
  let fenceCharacter = '';
  let fenceLength = 0;
  let inParagraph = false;

  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);

    if (inFence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fenceCharacter &&
        fenceMatch[1].length >= fenceLength &&
        line.slice(fenceMatch[0].length).trim() === ''
      ) {
        inFence = false;
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }

    if (fenceMatch) {
      inFence = true;
      fenceCharacter = fenceMatch[1][0];
      fenceLength = fenceMatch[1].length;
      counts.code_blocks += 1;
      if (/^(?:mermaid|dot|plantuml)\s*$/i.test(line.slice(fenceMatch[0].length).trim())) counts.diagram_blocks += 1;
      inParagraph = false;
      continue;
    }

    outsideFenceLines.push(line);

    const trimmed = line.trim();
    if (/^\s{0,3}(?:>\s*)?(?:\[![A-Za-z]+\]|(?:\*\*|__)[^\n*_]{1,60}:(?:\*\*|__))/u.test(line)) counts.callout_lines += 1;

    if (trimmed === '') {
      inParagraph = false;
      continue;
    }

    if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(line)) {
      counts.headings += 1;
      inParagraph = false;
      continue;
    }

    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      inParagraph = false;
      continue;
    }

    if (/^\s*(?:\d{1,9}[.)])\s+/.test(line)) {
      counts.ordered_items += 1;
      inParagraph = false;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      counts.bullet_items += 1;
      inParagraph = false;
      continue;
    }

    if (tableMetadata(lines).separators.has(lineIndex)) { inParagraph = false; continue; }
    if (isTableRow(lineIndex, lines)) {
      counts.table_rows += 1;
      inParagraph = false;
      continue;
    }

    if (!inParagraph) {
      counts.paragraphs += 1;
      inParagraph = true;
    }
  }

  const proseOutsideInlineCode = removeInlineCode(outsideFenceLines.join('\n'));
  counts.emphasis_spans = countBoldSpans(proseOutsideInlineCode);
  counts.question_marks = (proseOutsideInlineCode.match(/\?/g) || []).length;

  return {
    status: 'observed',
    headings: counts.headings,
    ordered_items: counts.ordered_items,
    bullet_items: counts.bullet_items,
    code_blocks: counts.code_blocks,
    diagram_blocks: counts.diagram_blocks,
    callout_lines: counts.callout_lines,
    table_rows: counts.table_rows,
    paragraphs: counts.paragraphs,
    emphasis_spans: counts.emphasis_spans,
    question_marks: counts.question_marks,
  };
}

export function compareObserverResponses(input) {
  const source = input !== null && typeof input === 'object' ? input : {};
  const withoutDescriptor = describeObserverResponse(source.without);
  const withDescriptor = describeObserverResponse(source.with);

  if (withoutDescriptor.status !== 'observed' || withDescriptor.status !== 'observed') {
    return {
      status: 'unavailable',
      without: withoutDescriptor,
      with: withDescriptor,
      differences: [],
      depth: 'unverified',
      conversation_quality: 'unverified',
    };
  }

  const differences = COUNT_FIELDS.filter(
    (field) => withoutDescriptor[field] !== withDescriptor[field],
  );

  return {
    status: differences.length > 0 ? 'different' : 'no_detected_difference',
    without: withoutDescriptor,
    with: withDescriptor,
    differences,
    depth: 'unverified',
    conversation_quality: 'unverified',
  };
}

export function observerExcerpt(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return null;
  }

  const start = options.start === undefined ? 0 : options.start;
  const maxChars =
    options.maxChars === undefined ? DEFAULT_EXCERPT_CHARS : options.maxChars;

  if (!Number.isInteger(start) || !Number.isInteger(maxChars)) {
    return null;
  }
  if (start < 0 || start >= text.length) {
    return null;
  }
  if (maxChars < 1 || maxChars > MAX_EXCERPT_CHARS) {
    return null;
  }

  const end = Math.min(text.length, start + maxChars);
  return {
    text: text.slice(start, end),
    start,
    end,
  };
}

export function validateObserverExcerpt(source, excerpt) {
  if (typeof source !== 'string' || source.length === 0) {
    return false;
  }
  if (excerpt === null || typeof excerpt !== 'object' || Array.isArray(excerpt)) {
    return false;
  }
  if (Reflect.ownKeys(excerpt).length !== 3) {
    return false;
  }

  const keys = Object.keys(excerpt);
  if (
    keys.length !== 3 ||
    !keys.includes('text') ||
    !keys.includes('start') ||
    !keys.includes('end')
  ) {
    return false;
  }

  const { text, start, end } = excerpt;

  if (typeof text !== 'string' || text.length < 1 || text.length > MAX_EXCERPT_CHARS) {
    return false;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return false;
  }
  if (start < 0 || end < start || end > source.length) {
    return false;
  }
  if (end - start !== text.length) {
    return false;
  }

  return source.slice(start, end) === text;
}

// Coordinator integration. Public experience objects contain only generated
// descriptions and closed metadata. Assistant text lives solely in this ephemeral
// WeakMap, for local rendering; it cannot enter JSON/model/export payloads.
const localResponses = new WeakMap();
const armNames = ['without', 'with'];
const nonnegative = x => Number.isSafeInteger(x) && x >= 0;
const positive = x => nonnegative(x) && x > 0;
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const knownModels = new Set(['muse-spark-1.3', 'muse-wonder-1.0', 'fake-model']);
function observedModelIdentity(model) {
  if (model?.status!=='observed' || !knownModels.has(model.requested_model) || !positive(model.requests_observed) || model.unidentified_requests!==0 || !Array.isArray(model.observed_models) || model.observed_models.length!==1 || model.observed_models[0]!==model.requested_model) return null;
  return model.observed_models[0];
}
function modelHasMismatch(model) {
  return model?.status==='mismatch' || knownModels.has(model?.requested_model) && Array.isArray(model?.observed_models) && model.observed_models.some(id=>knownModels.has(id) && id!==model.requested_model);
}

const controlsOf = c => c && ['terse','standard','full'].includes(c.response_extent) && ['send','defer'].includes(c.unsolicited_update) && ['self_contained','conversational'].includes(c.conversation_style)
  ? {response_extent:c.response_extent,unsolicited_update:c.unsolicited_update,conversation_style:c.conversation_style} : null;
const policyText = c => `${c.response_extent} · ${c.unsolicited_update} updates · ${c.conversation_style.replaceAll('_',' ')}`;
const number = x => nonnegative(x) ? String(x) : 'unavailable';
const terminal = a => ['ready','closed'].includes(a?.status) && (!a.last_turn_terminal || a.last_turn_terminal === 'completed');
const sumKnown = xs => xs.length && xs.every(nonnegative) && nonnegative(xs.reduce((a,b)=>a+b,0)) ? xs.reduce((a,b)=>a+b,0) : null;

function scopedResponse(state, arm) {
  const a = state?.arms?.[arm], d = a?.delivery;
  if (!terminal(a) || !positive(d?.turn_ordinal) || d?.turn_completed !== true || !positive(d.public_finals) || d.public_finals > 64 || !Array.isArray(a.messages) || a.messages.length > 512) return null;
  const finals = a.messages.map((m,index)=>({...m,index})).filter(m=>m.author==='Muse' && m.phase==='finalAnswer');
  if (finals.length < d.public_finals) return null;
  // Native snapshots append finals in the same order as delivery.publicFinal.
  // Only the completed current turn's suffix is admitted, never all history.
  const rows = finals.slice(-d.public_finals);
  if (rows.some(m=>describeObserverResponse(m.text).status!=='observed')) return null;
  const final = rows.at(-1), scope = {arm,turn:d.turn_ordinal,final:d.public_finals,message_index:final.index};
  if (arm === 'without') {
    if (d.status !== 'baseline_isolated' || !positive(d.requests_observed) || d.requests_observed > 64) return null;
    return {...scope,text:final.text,linkage:'turn_scoped',request:null,reading:null,controls:null};
  }
  const requests=d.request_attribution, proof=d.response_attribution;
  if (d.hook_linkage!=='read_marker_matched' || d.response_linkage!=='public_final_matched' || !['linked','partial'].includes(proof?.status) || !Array.isArray(requests) || requests.length!==d.requests_observed || !requests.length || requests.length>64 || new Set(requests.map(r=>r?.read_id)).size!==requests.length) return null;
  if (!requests.every((r,i)=>r?.ordinal===i+1 && uuid(r.read_id) && (r.status==='fallback_observed' || r.status==='guidance_observed' && uuid(r.reading_id) && controlsOf(r.controls)))) return null;
  if (!Array.isArray(proof.requests) || proof.requests.length!==requests.length || !Array.isArray(proof.finals) || proof.finals.length!==d.public_finals || proof.linked_finals!==d.public_finals || new Set(proof.finals.map(f=>f?.request_ordinal)).size!==proof.finals.length) return null;
  const linked = proof.finals.every((f,i)=>{
    const r=requests[f?.request_ordinal-1],p=proof.requests[f?.request_ordinal-1];
    const presence=r?.status==='guidance_observed'?'guidance':r?.status==='fallback_observed'?'fallback':null;
    return f?.ordinal===i+1 && f.status==='final_linked' && positive(f.request_ordinal) && presence && f.presence===presence && p?.ordinal===f.request_ordinal && p.status==='response_linked' && p.presence===presence;
  });
  if (!linked) return null;
  const request = requests[proof.finals.at(-1).request_ordinal-1];
  return {...scope,text:final.text,linkage:'request_linked',request:request.ordinal,read_id:request.read_id,reading:request.status==='guidance_observed'?request.reading_id:null,controls:request.status==='guidance_observed'?controlsOf(request.controls):null,receipt_age_seconds:typeof request.receipt_age_seconds==='number' && Number.isFinite(request.receipt_age_seconds) && request.receipt_age_seconds>=0?request.receipt_age_seconds:null,contract:request.collaboration_contract?.status==='matched' && [1,2,3].includes(request.collaboration_contract.version)?request.collaboration_contract.version:null};
}

function readingLabel(state, id, expectedControls=null) {
  if (!uuid(id)) return 'unavailable reading';
  const readings=Array.isArray(state?.textbox?.readings)?state.textbox.readings.slice(-200):[];
  const matches=readings.map((r,i)=>({r,i})).filter(x=>x.r?.reading_id===id);
  if (matches.length!==1) return 'reading '+id;
  const {r,i}=matches[0],c=controlsOf(r.controls);
  if (!c || !Number.isFinite(Date.parse(r.received_at)) || !Number.isFinite(Date.parse(r.generated_at))) return 'reading '+id;
  if(expectedControls && Object.keys(expectedControls).some(k=>c[k]!==expectedControls[k])) return 'recorded reading '+id+' (history policy differs; history link unverified)';
  const offset=nonnegative(state.textbox.readings_omitted)?state.textbox.readings_omitted:0;
  return 'reading '+(offset+i+1);
}

function responseLink(state, response) {
  if (!response) return 'Latest response-to-reading link unavailable; no response is attributed to the current policy.';
  const lead=`With turn ${response.turn}, final ${response.final} → request ${response.request}`;
  if (!response.controls) return `${lead} → ordinary fallback. No reading was selected for this request.`;
  const receipt=response.receipt_age_seconds===null?'receipt age unavailable':`receipt age ${Math.floor(response.receipt_age_seconds)}s at request`;
  const current=uuid(state?.textbox?.reading_id)?state.textbox.reading_id:null;
  const relation=current && current!==response.reading?' A different reading is selected now; this final request matched the earlier reading.':current===response.reading && state.textbox?.reading_freshness==='last_known'?' That reading is last-known now, not a new observation.':'';
  const version=response.contract?` Optional presentation hints v${response.contract} matched this request.`:' Optional presentation-hint delivery is unverified.';
  return `${lead} → ${readingLabel(state,response.reading,response.controls)} (${receipt}): ${policyText(response.controls)}.${relation}${version}`;
}

function currentSource(state, now) {
  const s=state?.presence?.source,c=controlsOf(s?.controls),stamp=Date.parse(s?.read_at);
  if(s?.eligible!==true || !c || !Number.isFinite(stamp) || !Number.isFinite(now) || now-stamp>20000 || stamp-now>5000) return 'Current source: ordinary fallback or unavailable. Historical request evidence remains separate.';
  return `Selected now: ${s.guidance_lifetime==='active_session' && s.reading_freshness==='last_known'?'last-known accepted guidance':'eligible guidance'} · ${policyText(c)}. This current source is not evidence of what an older response used.`;
}

function resourceValue(state, arm, key) {
  const usage=state?.arms?.[arm]?.usage;
  return usage?.status==='observed' && ['native','provider_trace'].includes(usage.source) && nonnegative(usage[key])?usage[key]:null;
}
function elapsedValue(state,arm) {
  const e=state?.arms?.[arm]?.elapsed;return ['completed','partial','running'].includes(e?.status) && typeof e.total_seconds==='number' && Number.isFinite(e.total_seconds) && e.total_seconds>=0 ? e.total_seconds : null;
}
function resources(state) {
  const fields=[['model_calls','calls'],['input_tokens','input tokens'],['output_tokens','output tokens'],['cache_read_tokens','cached input']];
  const values=Object.fromEntries(armNames.map(arm=>[arm,fields.map(([k,label])=>`${number(resourceValue(state,arm,k))} ${label==='calls'&&resourceValue(state,arm,k)===1?'call':label}`).join(' · ')+(elapsedValue(state,arm)===null?' · elapsed unavailable':` · ${elapsedValue(state,arm)}s elapsed`)]));
  const changes=fields.slice(0,3).flatMap(([k,label])=>{
    const a=resourceValue(state,'without',k),b=resourceValue(state,'with',k);
    return a===null || b===null?[]:[`${label} ${b===a?'unchanged':b>a?'increased by '+(b-a):'decreased by '+(a-b)}`];
  });
  const before=elapsedValue(state,'without'),after=elapsedValue(state,'with');if(before!==null && after!==null)changes.push('elapsed seconds '+(before===after?'unchanged':after>before?'increased by '+Number((after-before).toFixed(3)):'decreased by '+Number((before-after).toFixed(3))));
  return {values,summary:changes.length?'With vs Without: '+changes.join('; ')+'.':'Comparable resource totals unavailable.',known:armNames.some(a=>elapsedValue(state,a)!==null || fields.some(([k])=>resourceValue(state,a,k)!==null))};
}
function interactionValues(state, arm) {
  const q=state?.arms?.[arm]?.interactions,actions=state?.measurement?.actions;
  const approvals=sumKnown(['participant','coordinator','unattributed'].map(role=>actions?.[role]?.arms?.[arm]?.approval_decisions));
  const interrupts=sumKnown(['participant','coordinator','unattributed'].map(role=>state?.measurement?.turn_actions?.[role]?.[arm]?.interrupt_accepted));
  return {questions:q?.enabled===true && nonnegative(q.questions_presented)?q.questions_presented:null,approvals,interrupts};
}
function navigation(d) {
  if (d?.status!=='observed') return 'Response unavailable';
  const features=[['ordered_items','numbered','numbered'],['bullet_items','bullet','bullets'],['headings','heading','headings'],['emphasis_spans','emphasis','emphasis'],['code_blocks','code block','code blocks'],['diagram_blocks','diagram-marked fence','diagram-marked fences'],['callout_lines','callout-marked line','callout-marked lines'],['table_rows','table row','table rows'],['paragraphs','prose block','prose blocks']];
  return features.filter(([key])=>d[key]>0).map(([key,singular,plural])=>`${d[key]} ${d[key]===1?singular:plural}`).join(' · ') || 'No counted navigation markers';
}

export function buildObserverExperience(state, {metrics=null,now=Date.now()}={}) {
  const responses=Object.fromEntries(armNames.map(a=>[a,scopedResponse(state,a)]));
  const comparison=compareObserverResponses(Object.fromEntries(armNames.map(a=>[a,responses[a]?.text??null])));
  const turns=armNames.map(a=>state?.arms?.[a]?.delivery?.turn_ordinal);
  const matched=state?.comparison?.matched_context;
  const models=armNames.map(a=>state?.arms?.[a]?.model);
  const identities=models.map(observedModelIdentity);
  const modelMatched=identities.every(id=>id!==null) && identities[0]===identities[1];
  const modelMismatch=models.some(modelHasMismatch) || models.every(m=>knownModels.has(m?.requested_model)) && models[0].requested_model!==models[1].requested_model;
  const scope=state?.arms?.without?.delivery?.status==='baseline_contaminated'?'Presence was detected in the baseline request; this comparison is invalid.':matched===false?'Histories differ; these observations are descriptive, not a controlled comparison.':modelMismatch?'Model identities differ or mismatch; these observations are descriptive.':!modelMatched?'Model matching is unverified; these observations are descriptive.':matched!==true?'History matching is unverified; these observations are descriptive.':!responses.with || !responses.without || turns[0]!==turns[1]?'A comparable latest completed turn is unverified. Available session observations remain descriptive.':'Compatible observed model identities, same turn ordinals and matched histories reported; one pair does not establish causality.';
  const paired=matched===true && modelMatched && !modelMismatch && !!responses.with && !!responses.without && turns[0]===turns[1];
  const r=resources(state),i=Object.fromEntries(armNames.map(a=>[a,interactionValues(state,a)]));
  const reviews=state?.measurement?.review?.arms;
  const rating=arm=>Number.isInteger(reviews?.[arm]?.effort_rating) && reviews[arm].effort_rating>=1 && reviews[arm].effort_rating<=5?`${reviews[arm].effort_rating}/5`:'unavailable';
  const interruptions=arm=>Number.isInteger(reviews?.[arm]?.interruption_count) && reviews[arm].interruption_count>=0 && reviews[arm].interruption_count<=100?reviews[arm].interruption_count:null;
  const m=metrics;
  const metricKeys=['held_current','held_total','released_manual','released_automatic','history_resets'];
  const metricValid=m?.schema_version===1 && ['observed','partial'].includes(m.coverage) && metricKeys.every(k=>nonnegative(m[k])) && m.held_current+m.released_manual+m.released_automatic<=m.held_total && (m.coverage==='partial' || m.held_current+m.released_manual+m.released_automatic===m.held_total);
  const holds=metricValid?`This view: ${m.held_total} optional updates held; ${m.held_current} still held, ${m.released_manual} shown manually, ${m.released_automatic} released automatically (${m.coverage} coverage).`:'Optional-update delivery unavailable for this view.';
  const navStatus=comparison.status==='different'?'Different structure observed':comparison.status==='no_detected_difference'?'No structural difference detected':'Structural comparison unavailable';
  const modelLabels=armNames.map(a=>{
    const m=state?.arms?.[a]?.model;
    const status=observedModelIdentity(m)?'observed':modelHasMismatch(m)?'mismatch':['partial','not_observed','unavailable'].includes(m?.status)?m.status:'identity unverified';
    const observed=Array.isArray(m?.observed_models)?[...new Set(m.observed_models.filter(id=>knownModels.has(id)))].slice(0,2).join(', '):'';
    return `${a==='with'?'With':'Without'}: requested ${knownModels.has(m?.requested_model)?m.requested_model:'unavailable'}; observed ${observed||'unavailable'} (${status})`;
  }).join(' · ');
  const row=(id,title,status,without,withValue,summary,detail)=>({id,title,status,without,with:withValue,summary,detail});
  const dimensions=[
    row('interaction','Interaction',armNames.some(a=>i[a].questions!==null || i[a].approvals!==null)?'observed':'unverified',...armNames.map(a=>`${number(i[a].questions)} native ${i[a].questions===1?'question':'questions'} · ${number(i[a].approvals)} approval ${i[a].approvals===1?'decision':'decisions'}`),'Questions and approvals are distinct interaction events.','Session totals. Native questions are not inferred from question marks; approvals are necessary permission decisions.'),
    row('interruptions','Interruptions',armNames.some(a=>interruptions(a)!==null)?'self_reported':metricValid || armNames.some(a=>i[a].interrupts!==null)?'observed':'unverified',...armNames.map(a=>`${number(interruptions(a))} reported · ${number(i[a].interrupts)} accepted hard interrupts`),holds,'Reported interruptions are user ratings. Accepted hard interrupts, approval decisions and optional updates are separate; none establishes distraction or attention.'),
    row('resources','Resources',r.known?'observed':'unverified',r.values.without,r.values.with,r.summary,'Cumulative session totals, not latest-response costs. Cached input is part of input. Observer usage is separate; cost and causal savings unavailable.'),
    row('presentation','Presentation',comparison.status==='unavailable'?'unverified':'observed',navigation(comparison.without),navigation(comparison.with),navStatus+'.','Latest scoped final only. Syntax counts describe navigation, not usefulness or adaptation; diagram-marked code is not verified rendered artwork. Essential content and explicit requested formats retain priority.'),
    row('depth','Depth','unverified','Not assessed','Not assessed','Content depth and correctness are unverified.','Word count, Markdown and code fences do not establish reasoning depth, completeness or quality. Exact-format answers may appropriately share a structure.'),
    row('conversation','Conversation','unverified',...armNames.map(a=>comparison[a].status==='observed'?`${comparison[a].question_marks} prose question marks · effort ${rating(a)}`:`Question marks unavailable · effort ${rating(a)}`),'Conversational quality is unverified; effort ratings are self-reported.','Question punctuation is descriptive and excludes code; it is not a native clarification count or evidence of appropriate tone. No personal state is inferred.')
  ];
  const link=responseLink(state,responses.with);
  const featureLabels={headings:'headings',ordered_items:'numbered items',bullet_items:'bullets',code_blocks:'code blocks',diagram_blocks:'diagram-marked code',callout_lines:'callout markers',table_rows:'table rows',paragraphs:'prose blocks',emphasis_spans:'bold emphasis',question_marks:'prose question marks'};
  const changes=comparison.status==='different'?`Presentation differs in ${comparison.differences.map(x=>featureLabels[x]).join(', ')}.`:comparison.status==='no_detected_difference'?'No structural response difference was detected; different wording may still be present.':'A response comparison is not verified.';
  const interaction=`Native questions: Without ${number(i.without.questions)}, With ${number(i.with.questions)}; reported interruptions: ${number(interruptions('without'))} / ${number(interruptions('with'))}.`;
  const paragraph=`${changes} ${interaction} ${r.summary} Depth and conversational quality remain unverified; effort is self-reported (${rating('without')} / ${rating('with')}). ${responses.with?.controls?`The With final is linked to ${readingLabel(state,responses.with.reading,responses.with.controls)} and its recorded ${responses.with.controls.response_extent} / ${responses.with.controls.conversation_style.replaceAll('_',' ')} guidance.`:responses.with?'The With final is linked to an ordinary-fallback request.':'Response-to-reading attribution is unavailable.'} No benefit or causal adaptation is established.`;
  const references=armNames.flatMap(a=>responses[a]?[Object.fromEntries(Object.entries(responses[a]).filter(([key])=>['arm','turn','final','message_index','linkage','request','read_id','reading','controls','receipt_age_seconds','contract'].includes(key)))]:[]);
  const experience={schema_version:1,paragraph,scope,paired,source:currentSource(state,now),link,models:modelLabels,dimensions,references};
  localResponses.set(experience,responses);
  return experience;
}

export function observerLocalEvidence(experience) {
  const responses=localResponses.get(experience);
  if (!responses) return [];
  return armNames.flatMap(arm=>{
    const r=responses[arm];if(!r)return[];
    // Centre one bounded quote near a navigation/conversation marker when present.
    const match=/^\s*(?:#{1,6}\s|\d+[.)]\s|[-*+]\s|\*\*|__|\|)|\?/m.exec(r.text);
    const excerpt=observerExcerpt(r.text,{start:match?Math.max(0,match.index-40):0,maxChars:400});
    if(!validateObserverExcerpt(r.text,excerpt))return[];
    return [{arm,turn:r.turn,final:r.final,request:r.request,read_id:r.read_id??null,reading_id:r.reading,linkage:r.linkage,excerpt}];
  });
}

// Safe report metadata: never project excerpts, response text, or unknown keys.
export function projectObserverExperience(value) {
  if(value?.schema_version!==1 || typeof value.paired!=='boolean' || !Array.isArray(value.dimensions) || value.dimensions.length!==6) return null;
  const textKeys=['paragraph','scope','source','link','models'];
  if(textKeys.some(k=>typeof value[k]!=='string' || value[k].length>1600))return null;
  const ids=['interaction','interruptions','resources','presentation','depth','conversation'];
  const dimensions=[];
  for(const [index,row] of value.dimensions.entries()){
    const keys=['title','without','with','summary','detail'];
    if(row?.id!==ids[index] || !['observed','self_reported','unverified'].includes(row.status) || keys.some(k=>typeof row[k]!=='string'||row[k].length>800))return null;
    dimensions.push({id:row.id,status:row.status,...Object.fromEntries(keys.map(k=>[k,row[k]]))});
  }
  // References are useful locally; reports intentionally retain the readable link
  // and closed dimension observations only, no transcript locations or quotes.
  return{schema_version:1,paired:value.paired,...Object.fromEntries(textKeys.map(k=>[k,value[k]])),dimensions};
}

// Live observer history is page-local. Public snapshots lack historical turn IDs;
// retain only completed, request-verified pairs actually observed by this page.
// Raw replies never become properties of the serializable view or model evidence.
const progressReplies = new WeakMap();
const progressStates = {not_started:'not started',starting:'starting',running:'working',approval:'waiting for approval',question:'waiting for your answer',ready:'ready',closed:'closed',failed:'failed'};
const extentName = value => ({terse:'brief',standard:'standard',full:'full'}[value] ?? 'unverified');
const words = text => text.trim().split(/\s+/u).length;
function displayFinal(arm) {
  const d=arm?.delivery;
  if (arm?.status==='starting' || ['running','approval','question'].includes(arm?.status) && d?.turn_completed===true) return null;
  if (!positive(d?.turn_ordinal) || !positive(d.public_finals) || d.public_finals>64 || !Array.isArray(arm.messages) || arm.messages.length>512) return null;
  const finals=arm.messages.filter(m=>m?.author==='Muse' && m.phase==='finalAnswer');
  if (finals.length<d.public_finals) return null;
  const text=finals.at(-1)?.text;
  return isValidResponseText(text)?text:null;
}
function explicitSections(text) {
  // Closed section names describe literal labels, not test execution or quality.
  const labels=[['cost','(?:cost|complexity)'],['verification','(?:validation|verification|tests?)'],['limitations','(?:limitations?|tradeoffs?|trade-offs?)']];
  const lines=[];let fence=null;
  for(const line of text.split(/\r?\n/)){
    const mark=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if(fence){if(mark && mark[1][0]===fence[0] && mark[1].length>=fence.length && !line.slice(mark[0].length).trim())fence=null;continue;}
    if(mark){fence=mark[1];continue;}lines.push(line);
  }
  const prose=lines.join('\n').replace(/`[^`]*`/g,'');
  return labels.filter(([,pattern])=>new RegExp('^\\s*(?:#{1,6}\\s+)?(?:\\*\\*|__)?'+pattern+'(?:\\*\\*|__)?\\s*(?::|$)','im').test(prose)).map(([label])=>label);
}
function progressSummary(record, previous) {
  const {responses,proofs,paired}=record, a=responses.without,b=responses.with;
  const finished=arm=>!!responses[arm] && record.complete[arm];
  if (!a || !b || !record.complete.with || !record.complete.without) {
    const state=arm=>finished(arm)?'has finished':`is ${record.statuses[arm]}`;
    return `Without ${state('without')}; With ${state('with')}. `+(a||b?'Available final replies are shown; this moment is still incomplete.':'Final replies will appear here as the tasks progress.');
  }
  if (!paired) return 'Both final replies are available. '+record.scope;
  const c=proofs.with?.controls;
  if (!c) return 'Both replies are available; the With final request used ordinary fallback. No reading is credited with this reply.';
  const wa=words(a),wb=words(b),before=previous?.proofs.with?.controls;
  let lead;
  if (before && before.response_extent!==c.response_extent) {
    const change=wb>words(previous.responses.with)?'became longer':wb<words(previous.responses.with)?'became shorter':'stayed the same length';
    lead=`Guidance changed from ${extentName(before.response_extent)} to ${extentName(c.response_extent)}; the With reply ${change}.`;
  } else lead=a===b?'The two final replies are identical.':`With gives a ${wb<wa?'shorter':wb>wa?'longer':'similarly sized'} reply than Without.`;
  const sections=explicitSections(b).filter(x=>!previous || !explicitSections(previous.responses.with).includes(x));
  const detail=sections.length?` With ${previous?'now includes':'includes'} explicit ${sections.slice(0,2).join(' and ')} sections.`:'';
  return lead+detail+` Its final request used ${extentName(c.response_extent)}, ${c.conversation_style.replaceAll('_',' ')} guidance.`;
}
export function createObserverProgress() {
  let generation=null,history=[];
  return {observe(state) {
    const g=state?.session_generation;
    if (!nonnegative(g) || generation!==null && g<generation) return makeView([],null,'No current session comparison is available.');
    if (g!==generation) {generation=g;history=[];}
    const experience=buildObserverExperience(state),turns=armNames.map(a=>state?.arms?.[a]?.delivery?.turn_ordinal??0);
    const proofs=Object.fromEntries(armNames.map(a=>[a,scopedResponse(state,a)]));
    const pendingStart=armNames.some(a=>['starting','running','approval','question'].includes(state?.arms?.[a]?.status) && state.arms[a].delivery?.turn_completed===true);
    const current={key:g+':'+turns.join(':')+(pendingStart?':pending':''),turns,paired:experience.paired,scope:experience.scope,
      responses:Object.fromEntries(armNames.map(a=>[a,displayFinal(state?.arms?.[a])])),proofs,
      statuses:Object.fromEntries(armNames.map(a=>[a,state?.arms?.[a]?.status==='ready' && state.arms[a].last_turn_terminal==='cancelled'?'interrupted':progressStates[state?.arms?.[a]?.status]??'unavailable'])),
      complete:Object.fromEntries(armNames.map(a=>[a,terminal(state?.arms?.[a]) && state.arms[a]?.delivery?.turn_completed===true]))};
    const previous=history.findLast(x=>x.key!==current.key && x.paired && x.turns.every((t,i)=>t<turns[i]));
    current.summary=g===0?'Open the sessions and send a task to compare their replies here.':progressSummary(current,previous);
    const proof=proofs.with;
    current.guidance=proof?.controls?`${extentName(proof.controls.response_extent)} · ${proof.controls.conversation_style.replaceAll('_',' ')} · ${readingLabel(state,proof.reading,proof.controls)}`:proof?'Ordinary fallback':current.responses.with?'Reading link unverified':'Reading link pending';
    current.link=responseLink(state,proof);
    current.label=pendingStart?'Starting next turn':turns[0]===turns[1] && positive(turns[0])?`Turn ${turns[0]}`:turns.some(positive)?`Without ${turns[0]||'—'} · With ${turns[1]||'—'}`:'Current tasks';
    if (current.paired) {history=history.filter(x=>x.key!==current.key);history.push(current);history=history.slice(-8);}
    // Never keep an older verified copy of the current turn after its proof fails.
    else history=history.filter(x=>x.key!==current.key);
    const moments=[...history.filter(x=>x.key!==current.key),current];
    return makeView(moments,current.key,current.summary);
  }};
}
function makeView(records,latest,summary) {
  const view={summary,latest_key:latest,moments:records.map(x=>({key:x.key,label:x.label,guidance:x.guidance,summary:x.summary,scope:x.scope,link:x.link,paired:x.paired})),limits:'Observed replies and request links; causal effect, reasoning depth and benefit remain unverified.'};
  progressReplies.set(view,records);return view;
}
export function observerProgressReplies(view,key=view?.latest_key) {
  const record=progressReplies.get(view)?.find(x=>x.key===key);
  if (!record) return [];
  return armNames.map(arm=>({arm,text:record.responses[arm],status:record.statuses[arm],complete:record.complete[arm],caption:record.proofs[arm]?arm==='with'?'Final reply · request-linked':'Final reply · turn-scoped; provider identity unverified':record.responses[arm]?'Public final · reading attribution unverified':'No final reply yet'}));
}

// Concrete recorded Presence changes for the rich report and archived views.
export const {presenceMomentCandidates,presenceMomentView,presenceChangeLabel,presenceMomentReference}=(()=>{
// Public, already-projected evidence only. Ordering never joins the two arms.
const FIELDS=['response_extent','unsolicited_update','conversation_style'];
const VALUES={response_extent:['terse','standard','full'],unsolicited_update:['send','defer'],conversation_style:['self_contained','conversational']};
const validControls=c=>c&&FIELDS.every(k=>VALUES[k].includes(c[k]));
const positive=n=>Number.isSafeInteger(n)&&n>0;
const policy=row=>validControls(row?.controls)?row.controls:row?.kind==='presence_request'&&row.arm==='with'&&row.status==='fallback_observed'?null:undefined;
const same=(a,b)=>JSON.stringify(FIELDS.map(k=>a?.[k]??null))===JSON.stringify(FIELDS.map(k=>b?.[k]??null));
const publicReply=(e,arm)=>e?.kind==='message'&&e.arm===arm&&e.author==='Muse'&&e.phase==='finalAnswer'&&typeof e.text==='string';

function presenceMomentCandidates(evidence){
 if(!Array.isArray(evidence))return[];const byId=new Map(evidence.map(e=>[e.id,e]));
 const lastReply=arm=>evidence.filter(e=>publicReply(e,arm)).sort((a,b)=>b.index-a.index)[0]??null;
 const exact=request=>{const link=evidence.find(e=>e.kind==='completion_link'&&e.arm==='with'&&e.status==='request_linked'&&e.request_id===request.id&&publicReply(byId.get(e.message_id),'with'));return link?{link,message:byId.get(link.message_id)}:null;};
 const requests=evidence.filter(e=>e.kind==='presence_request'&&e.arm==='with'&&positive(e.turn_ordinal)&&positive(e.ordinal)&&['guidance_observed','fallback_observed'].includes(e.status)&&policy(e)!==undefined).sort((a,b)=>a.turn_ordinal-b.turn_ordinal||a.ordinal-b.ordinal);
 const readings=evidence.filter(e=>e.kind==='presence_reading'&&validControls(e.controls)&&Number.isFinite(Date.parse(e.received_at))).sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at)||a.id.localeCompare(b.id,'en',{numeric:true}));
 const result=[];
 for(const [family,rows]of [['request',requests],['reading',readings]])for(let i=1;i<rows.length;i++){
  const before=rows[i-1],after=rows[i];if(same(policy(before),policy(after)))continue;
  if(family==='request'&&before.turn_ordinal===after.turn_ordinal&&before.ordinal===after.ordinal)continue;
  const prior=family==='request'?exact(before):null,next=family==='request'?exact(after):null;
  const beforeReply=prior?.message??null,afterReply=next?.message??null,context=afterReply??lastReply('with'),baseline=lastReply('without');
  const changed=FIELDS.filter(k=>(policy(before)?.[k]??null)!==(policy(after)?.[k]??null));
  const record={id:`presence.moment.${family}.${after.id.replace(/^presence\.(?:request|reading)\./,'')}`,kind:'presence_moment',scope:beforeReply&&afterReply&&beforeReply.id!==afterReply.id?'linked_reply_change':family==='request'?'request_change':'reading_change',before_id:before.id,after_id:after.id,changed_controls:changed,with_before_message_id:beforeReply?.id??null,with_after_message_id:afterReply?.id??null,with_before_link_id:prior?.link.id??null,with_after_link_id:next?.link.id??null,with_context_message_id:context?.id??null,baseline_message_id:baseline?.id??null,baseline_relation:'independent_reference'};
  const dependencies=[before,after,prior?.link,next?.link,beforeReply,afterReply,context,baseline].filter(Boolean);
  if(family==='reading'&&result.some(v=>same(policy(byId.get(v.record.before_id)),policy(before))&&same(policy(byId.get(v.record.after_id)),policy(after))&&byId.get(v.record.after_id)?.reading_id===after.reading_id))continue;
  result.push({record,dependencies:[...new Map(dependencies.map(e=>[e.id,e])).values()]});
 }
 // Exact response comparisons first. Within each family prefer recent changes.
 const order=new Map(result.map((v,i)=>[v,i])),rank={linked_reply_change:3,request_change:2,reading_change:1};
 return result.sort((a,b)=>rank[b.record.scope]-rank[a.record.scope]||order.get(b)-order.get(a));
}

function presenceMomentView(record){
 const evidence=record?.evidence??[],byId=new Map(evidence.map(e=>[e.id,e]));
 const candidates=evidence.filter(e=>e.kind==='presence_moment');
 const available=candidates.length?candidates:presenceMomentCandidates(evidence).map(v=>v.record);
 const selected=record?.report?.presence?.moments;
 const requests=available.filter(e=>e.scope!=='reading_change'),defaults=(requests.length?requests:available).slice(0,2);
 const rows=Array.isArray(selected)?selected.map(s=>({moment:available.find(e=>e.id===s.moment_id),baseline_id:s.baseline_message_id,label:s.label})):defaults.map(moment=>({moment,baseline_id:moment.baseline_message_id,label:'Recorded Presence change'}));
 return rows.flatMap(({moment,baseline_id,label})=>{
  if(!moment||!byId.has(moment.before_id)||!byId.has(moment.after_id))return[];
  const baseline=byId.get(baseline_id),before=byId.get(moment.with_before_message_id),after=byId.get(moment.with_after_message_id),context=byId.get(moment.with_context_message_id);
  return[{...moment,label:typeof label==='string'?label:'Recorded Presence change',before:byId.get(moment.before_id),after:byId.get(moment.after_id),baseline:publicReply(baseline,'without')?baseline:null,with_before:publicReply(before,'with')?before:null,with_after:publicReply(after,'with')?after:null,with_context:publicReply(context,'with')?context:null}];
 }).sort((a,b)=>a.after.kind!==b.after.kind?0:a.after.kind==='presence_reading'?Date.parse(a.after.received_at)-Date.parse(b.after.received_at):a.after.turn_ordinal-b.after.turn_ordinal||a.after.ordinal-b.after.ordinal);
}

function presenceChangeLabel(before,after){
 const labels={response_extent:{terse:'brief replies',standard:'standard detail',full:'fuller replies'},unsolicited_update:{send:'updates allowed',defer:'updates deferred'},conversation_style:{self_contained:'self-contained',conversational:'conversational'}};
 const a=policy(before),b=policy(after);if(a===null||b===null)return(a===null?'ordinary collaboration':FIELDS.map(k=>labels[k][a[k]]).join(', '))+' → '+(b===null?'ordinary collaboration':FIELDS.map(k=>labels[k][b[k]]).join(', '));
 return FIELDS.filter(k=>a?.[k]!==b?.[k]).map(k=>labels[k][a?.[k]]+' → '+labels[k][b?.[k]]).join(' · ');
}

function presenceMomentReference(moment){
 const {before,after}=moment;
 if(before?.kind==='presence_request'&&after?.kind==='presence_request')return before.turn_ordinal===after.turn_ordinal?`Turn ${after.turn_ordinal} · requests ${before.ordinal} → ${after.ordinal}`:`Turn ${before.turn_ordinal}, request ${before.ordinal} → turn ${after.turn_ordinal}, request ${after.ordinal}`;
 const time=e=>Number.isFinite(Date.parse(e?.received_at))?new Date(e.received_at).toISOString().slice(11,19)+' UTC':'recorded reading';
 return time(before)+' → '+time(after);
}

return {presenceMomentCandidates,presenceMomentView,presenceChangeLabel,presenceMomentReference};
})();

// Structured assessments keep source excerpts and arithmetic independent of the
// observer's interpretation. These helpers have no effects or provider access.
export function observerExcerptSpan(text,excerpt){
 if(typeof text!=='string'||typeof excerpt!=='string'||!excerpt.trim())return null;
 const chars=[],starts=[],ends=[];let whitespace=null;
 for(let i=0;i<text.length;i++){
  if(/\s/u.test(text[i])){if(chars.length&&whitespace===null)whitespace=i;continue;}
  if(whitespace!==null){chars.push(' ');starts.push(whitespace);ends.push(i);whitespace=null;}
  chars.push(text[i]);starts.push(i);ends.push(i+1);
 }
 const normalized=chars.join(''),needle=excerpt.replace(/\s+/gu,' ').trim(),at=normalized.indexOf(needle);if(at<0)return null;
 const start=starts[at],end=ends[at+needle.length-1];
 // A selected code-only span may omit its surrounding fences. Preserve its
 // native code appearance while keeping the excerpt itself literal.
 let fence=null;const closes=(line,mark)=>new RegExp('^\\s{0,3}'+mark[0]+'{'+mark.length+',}\\s*$').test(line);
 for(const line of text.slice(0,start).replace(/\r\n?/g,'\n').split('\n')){if(fence){if(closes(line,fence))fence=null;}else{const m=/^\s{0,3}(```+|~~~+)([^\n]*)$/.exec(line);if(m)fence=m[1];}}
 const selected=text.slice(start,end),mixed=fence&&selected.replace(/\r\n?/g,'\n').split('\n').some(line=>closes(line,fence));
 return{text:selected,start,end,render_as:fence&&!mixed?'code':'markdown',...(mixed?{render_prefix:fence+'\n'}:{})};
}

export function observerHighlightView(record){
 if(record?.report?.schema_version!==2||!Array.isArray(record.report.highlights))return[];
 const evidence=record.evidence??[],byId=new Map(evidence.map(e=>[e.id,e]));
 const phase=message=>message?.phase==='commentary'?'Update':message?.phase==='question'?'Question':'Reply';
 const turn=message=>evidence.find(e=>e.kind==='completion_link'&&e.message_id===message?.id)?.turn_ordinal??null;
 return record.report.highlights.slice(0,5).map(highlight=>{
  const frames={};for(const arm of ['without','with']){const selected=highlight[arm],message=byId.get(selected?.message_id),span=message?.kind==='message'&&message.author==='Muse'&&message.arm===arm?observerExcerptSpan(message.text,selected.excerpt):null;frames[arm]={message:span?message:null,span,turn:span?turn(message):null,phase:phase(message),missing:!span};}
  const policy=(highlight.policy_ids??[]).map(id=>byId.get(id)).filter(Boolean);
  return{...highlight,frames,policy,single_arm:frames.without.missing||frames.with.missing};
 });
}

export function observerHighlightPolicy(record,highlight){
 const byId=new Map((record?.evidence??[]).map(e=>[e.id,e])),labels={response_extent:{terse:'Brief replies',standard:'Standard detail',full:'Fuller replies'},unsolicited_update:{send:'updates allowed',defer:'updates deferred'},conversation_style:{self_contained:'self-contained',conversational:'conversational'}};
 const result=[],selected=highlight.policy??[];
 for(const row of selected){
  // A request already names the same reading's controls and task context.
  // Keep both source references in Details without repeating their label.
  if(row.kind==='presence_reading'&&row.reading_id&&selected.some(r=>r.kind==='presence_request'&&r.reading_id===row.reading_id&&JSON.stringify(r.controls)===JSON.stringify(row.controls)))continue;
  if(row.kind==='presence_moment'){const before=byId.get(row.before_id),after=byId.get(row.after_id);if(before&&after)result.push(presenceChangeLabel(before,after)+' · '+presenceMomentReference({before,after}));continue;}
  const controls=row.controls??row.current?.controls;
  if(controls&&labels.response_extent[controls.response_extent]){
   const words=[labels.response_extent[controls.response_extent],labels.unsolicited_update[controls.unsolicited_update],labels.conversation_style[controls.conversation_style]].filter(Boolean).join(' · ');
   result.push(words+(row.kind==='presence_request'?` · turn ${row.turn_ordinal}, request ${row.ordinal}`:row.kind==='presence_reading'&&Number.isFinite(Date.parse(row.received_at))?' · '+new Date(row.received_at).toISOString().slice(11,19)+' UTC':''));
  }else if(row.status==='fallback_observed')result.push('Ordinary collaboration · no Presence guidance on this request');
 }
 return[...new Set(result)].join(' / ');
}

export function observerSessionResources(record){
 const evidence=record?.evidence??[],get=id=>evidence.find(e=>e.id===id),number=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const values={};for(const arm of ['without','with']){
  const t=get('telemetry.'+arm),i=get('interactions.'+arm),u=t?.usage??{},input=number(u.input_tokens),cache=number(u.cache_read_tokens),elapsed=t?.elapsed;
  values[arm]={completed_turns:number(i?.completed_turns??elapsed?.completed_turns),model_calls:number(u.model_calls),input_tokens:input,output_tokens:number(u.output_tokens),cache_read_tokens:cache,input_minus_cache:input!==null&&cache!==null&&cache<=input?input-cache:null,cache_consistent:input===null||cache===null?null:cache<=input,elapsed_seconds:Number.isFinite(elapsed?.total_seconds)&&elapsed.total_seconds>=0?elapsed.total_seconds:null,elapsed_status:elapsed?.status??'unavailable',accepted_interrupts:number(i?.actors?.participant?.interrupt_accepted),reported_interruptions:number(i?.self_report?.interruption_count),effort_rating:number(i?.self_report?.effort_rating)};
 }
 const rows=[['completed_turns','Completed turns'],['model_calls','Model calls'],['input_tokens','Input tokens'],['output_tokens','Output tokens'],['cache_read_tokens','Cache-read input'],['input_minus_cache','Input minus cache reads'],['elapsed_seconds','Recorded turn time']].map(([key,label])=>({key,label,without:values.without[key],with:values.with[key],...(key==='elapsed_seconds'?{without_status:values.without.elapsed_status,with_status:values.with.elapsed_status}:{})}));
 return{rows,arms:values,evidence_ids:['telemetry.without','telemetry.with','interactions.without','interactions.with'].filter(id=>get(id))};
}

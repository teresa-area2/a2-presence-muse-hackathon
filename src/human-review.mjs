// Participant-controlled measurements only: review-window wall time and
// explicit self-report. Neither implies attention, cognitive state, or benefit.
const ARMS=new Set(['without','with']);
const ACTIONS=new Set(['start','stop','feedback']);
const owns=(value,key)=>Object.hasOwn(value,key);
const fresh=()=>({elapsed_ms:0,completed_review_segments:0,has_window:false,effort_rating:null,interruption_count:null});

export class HumanReview {
  #now;
  #lastClock=null;
  #active=null;
  #arms={without:fresh(),with:fresh()};

  constructor(options=undefined) {
    if(options!==undefined&&typeof options!=='function'&&(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='now')))throw Error('human_review_clock_invalid');
    const now=options===undefined?()=>performance.now():typeof options==='function'?options:options.now;
    if(typeof now!=='function')throw Error('human_review_clock_invalid');
    this.#now=now;
  }

  #time() {
    let at;
    try{at=this.#now();}catch{throw Error('human_review_clock_invalid');}
    if(typeof at!=='number'||!Number.isFinite(at)||at<0||(this.#lastClock!==null&&at<this.#lastClock))throw Error('human_review_clock_invalid');
    return at;
  }

  // The caller may apply and persist a candidate before swapping it in.
  // The injected clock is shared; mutable measurement state is not.
  clone() {
    const copy=new HumanReview(this.#now);
    copy.#lastClock=this.#lastClock;
    copy.#active=this.#active?{...this.#active}:null;
    copy.#arms={without:{...this.#arms.without},with:{...this.#arms.with}};
    return copy;
  }

  apply(payload) {
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||![Object.prototype,null].includes(Object.getPrototypeOf(payload)))throw Error('human_review_action_invalid');
    const {arm,action}=payload;
    if(!ARMS.has(arm)||!ACTIONS.has(action))throw Error('human_review_action_invalid');
    const allowed=action==='feedback'?new Set(['arm','action','effort','interruptions']):new Set(['arm','action']);
    if(Object.keys(payload).some(key=>!allowed.has(key)))throw Error('human_review_action_invalid');

    if(action==='feedback') {
      if(!owns(payload,'effort')&&!owns(payload,'interruptions'))throw Error('human_review_feedback_invalid');
      if(owns(payload,'effort')&&payload.effort!==null&&(!Number.isInteger(payload.effort)||payload.effort<1||payload.effort>5))throw Error('human_review_feedback_invalid');
      if(owns(payload,'interruptions')&&payload.interruptions!==null&&(!Number.isInteger(payload.interruptions)||payload.interruptions<0||payload.interruptions>100))throw Error('human_review_feedback_invalid');
      const prior=this.#arms[arm];
      this.#arms[arm]={...prior,...(owns(payload,'effort')?{effort_rating:payload.effort}:{}),...(owns(payload,'interruptions')?{interruption_count:payload.interruptions}:{})};
      return;
    }
    if(action==='start') {
      if(this.#active)throw Error('human_review_already_active');
      const at=this.#time();
      this.#lastClock=at;
      this.#active={arm,started_at:at};
      this.#arms[arm]={...this.#arms[arm],has_window:true};
      return;
    }
    if(!this.#active||this.#active.arm!==arm)throw Error('human_review_not_active');
    const at=this.#time(),prior=this.#arms[arm],elapsed=prior.elapsed_ms+(at-this.#active.started_at);
    if(!Number.isFinite(elapsed)||!Number.isSafeInteger(prior.completed_review_segments+1))throw Error('human_review_clock_invalid');
    this.#lastClock=at;
    this.#arms[arm]={...prior,elapsed_ms:elapsed,completed_review_segments:prior.completed_review_segments+1};
    this.#active=null;
  }

  snapshot() {
    let at=null;
    if(this.#active)at=this.#time();
    const view=arm=>{
      const item=this.#arms[arm];
      const elapsed=item.elapsed_ms+(this.#active?.arm===arm?at-this.#active.started_at:0);
      if(!Number.isFinite(elapsed))throw Error('human_review_clock_invalid');
      return {review_window_seconds:item.has_window?elapsed/1000:null,
        completed_review_segments:item.completed_review_segments,
        effort_rating:item.effort_rating,interruption_count:item.interruption_count};
    };
    // Commit the clock watermark only after the entire projection validates.
    const result={active_arm:this.#active?.arm??null,arms:{without:view('without'),with:view('with')}};
    if(at!==null)this.#lastClock=at;
    return result;
  }
}

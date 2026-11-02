import test from 'node:test';
import assert from 'node:assert/strict';
import {HumanReview} from '../src/human-review.mjs';

test('review windows accumulate independently and snapshots include the active partial window',()=>{
  let clock=1000;const review=new HumanReview(()=>clock);
  assert.deepEqual(review.snapshot(),{active_arm:null,arms:{
    without:{review_window_seconds:null,completed_review_segments:0,effort_rating:null,interruption_count:null},
    with:{review_window_seconds:null,completed_review_segments:0,effort_rating:null,interruption_count:null}}});
  review.apply({arm:'without',action:'start'});
  clock=2500;assert.equal(review.snapshot().arms.without.review_window_seconds,1.5);
  clock=3500;review.apply({arm:'without',action:'stop'});
  clock=4000;review.apply({arm:'with',action:'start'});
  clock=4500;review.apply({arm:'with',action:'stop'});
  clock=5000;review.apply({arm:'without',action:'start'});
  clock=5750;review.apply({arm:'without',action:'stop'});
  const result=review.snapshot();
  assert.equal(result.active_arm,null);
  assert.equal(result.arms.without.review_window_seconds,3.25);
  assert.equal(result.arms.without.completed_review_segments,2);
  assert.equal(result.arms.with.review_window_seconds,0.5);
  assert.equal(result.arms.with.completed_review_segments,1);
  result.arms.without.review_window_seconds=999;
  assert.equal(review.snapshot().arms.without.review_window_seconds,3.25,'snapshots do not expose mutable internal state');
});

test('only one arm can have an active review window; rejected actions do not change state',()=>{
  let clock=0;let reads=0;const review=new HumanReview({now:()=>{reads++;return clock;}});
  review.apply({arm:'with',action:'start'});
  assert.throws(()=>review.apply({arm:'without',action:'start'}),/already_active/);
  assert.throws(()=>review.apply({arm:'with',action:'start'}),/already_active/);
  assert.throws(()=>review.apply({arm:'without',action:'stop'}),/not_active/);
  assert.equal(reads,1,'invalid transitions do not consume clock values');
  clock=1000;review.apply({arm:'with',action:'stop'});
  assert.throws(()=>review.apply({arm:'with',action:'stop'}),/not_active/);
  const result=review.snapshot();
  assert.equal(result.arms.with.review_window_seconds,1);
  assert.equal(result.arms.without.review_window_seconds,null);
});

test('self-reports retain unknown separately from known zero and can be explicitly cleared',()=>{
  const review=new HumanReview(()=>0);
  review.apply({arm:'with',action:'feedback',effort:3,interruptions:0});
  review.apply({arm:'without',action:'feedback',interruptions:2});
  let state=review.snapshot();
  assert.equal(state.arms.with.effort_rating,3);
  assert.equal(state.arms.with.interruption_count,0);
  assert.equal(state.arms.without.effort_rating,null);
  assert.equal(state.arms.without.interruption_count,2);
  review.apply({arm:'with',action:'feedback',effort:null});
  state=review.snapshot();
  assert.equal(state.arms.with.effort_rating,null);
  assert.equal(state.arms.with.interruption_count,0,'omitted feedback leaves the previous value intact');
  review.apply({arm:'without',action:'start'});review.apply({arm:'without',action:'stop'});
  assert.equal(review.snapshot().arms.without.review_window_seconds,0,'a measured zero is distinct from no window');
});

test('invalid actions and feedback are refused atomically',()=>{
  const review=new HumanReview(()=>100);
  review.apply({arm:'with',action:'feedback',effort:2,interruptions:1});
  const before=review.snapshot();
  for(const value of [null,[],{}, {arm:'other',action:'start'}, {arm:'with',action:'other'},
    {arm:'with',action:'start',effort:3}, {arm:'with',action:'feedback'},
    {arm:'with',action:'feedback',effort:0}, {arm:'with',action:'feedback',effort:6},
    {arm:'with',action:'feedback',effort:2.5}, {arm:'with',action:'feedback',effort:undefined},
    {arm:'with',action:'feedback',effort:5,interruptions:101},
    {arm:'with',action:'feedback',interruptions:-1}, {arm:'with',action:'feedback',interruptions:NaN},
    {arm:'with',action:'feedback',interruptions:1,text:'must not be stored'},
  ]){
    assert.throws(()=>review.apply(value),/human_review_/);
    assert.deepEqual(review.snapshot(),before);
  }
});

test('invalid or backward clocks reject without changing the active measurement',()=>{
  assert.throws(()=>new HumanReview({now:null}),/clock_invalid/);
  assert.throws(()=>new HumanReview({now:()=>1,other:true}),/clock_invalid/);
  let clock=100;const review=new HumanReview(()=>clock);
  review.apply({arm:'with',action:'start'});
  clock=200;assert.equal(review.snapshot().arms.with.review_window_seconds,0.1);
  for(const bad of [199,-1,NaN,Infinity,'200']){
    clock=bad;assert.throws(()=>review.apply({arm:'with',action:'stop'}),/clock_invalid/);
    assert.throws(()=>review.snapshot(),/clock_invalid/);
  }
  clock=250;review.apply({arm:'with',action:'stop'});
  const result=review.snapshot();
  assert.equal(result.active_arm,null);assert.equal(result.arms.with.review_window_seconds,0.15);
  assert.equal(result.arms.with.completed_review_segments,1);
  clock=249;assert.throws(()=>review.apply({arm:'without',action:'start'}),/clock_invalid/);
  assert.deepEqual(review.snapshot(),result);
});

test('candidate clones isolate timer transitions and feedback until a caller adopts them',()=>{
  let clock=100;const original=new HumanReview(()=>clock);
  original.apply({arm:'with',action:'start'});
  const candidate=original.clone();
  clock=600;candidate.apply({arm:'with',action:'stop'});
  candidate.apply({arm:'with',action:'feedback',effort:4,interruptions:0});
  assert.equal(candidate.snapshot().active_arm,null);
  assert.equal(candidate.snapshot().arms.with.review_window_seconds,0.5);
  assert.equal(candidate.snapshot().arms.with.effort_rating,4);
  assert.equal(original.snapshot().active_arm,'with');
  assert.equal(original.snapshot().arms.with.effort_rating,null);
  clock=1100;original.apply({arm:'with',action:'stop'});
  assert.equal(original.snapshot().arms.with.review_window_seconds,1);
  assert.equal(candidate.snapshot().arms.with.review_window_seconds,0.5);
});

test('a throwing clock is normalized without mutating measurement state',()=>{
  let broken=false;const review=new HumanReview(()=>{if(broken)throw Error('PRIVATE');return 100;});
  review.apply({arm:'without',action:'start'});
  broken=true;
  assert.throws(()=>review.apply({arm:'without',action:'stop'}),/^Error: human_review_clock_invalid$/);
  assert.throws(()=>review.snapshot(),/^Error: human_review_clock_invalid$/);
  broken=false;
  assert.equal(review.snapshot().active_arm,'without');
  review.apply({arm:'without',action:'stop'});
  assert.equal(review.snapshot().arms.without.completed_review_segments,1);
});

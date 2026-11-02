/** Presence Pulse, ported from the supplied Python design. No random sampling at render time. */
export const PRINT_RULES=Object.freeze({ringScale:28,rippleScale:.14,mixContrast:6,ringCurve:.9,points:120,seed:847,size:880,padding:48,accentWidth:6});
export const PRINT_BREATH_RULES=Object.freeze({basePeriod:3,periodRange:5,minDepth:.006,depthRange:.014,lag:1.6});
export function printBreathStyle(f,stability){
  const b=PRINT_BREATH_RULES,period=b.basePeriod+b.periodRange*stability;
  return `--pulse-period:${period.toFixed(3)}s;--pulse-scale:${(1+b.minDepth+b.depthRange*f).toFixed(4)};--pulse-delay:${(-(period-b.lag*f)).toFixed(3)}s`;
}
const INK='#1C1B2E',PAPER='#F6F2EA';
const COLORS=[[151,118,248],[246,192,142],[243,120,156]];
// Python random.Random(847): (k, uniform(0,2*pi), uniform(.4,1)/k**.7).
const HARMONICS=[[2,2.447563344059275,.5596617712074697],[3,1.1443003053484144,.42032048513606224],[5,3.5990651130295666,.1891781194270325],[7,6.146642899051478,.23706264943144245]];
const valid=v=>Number.isFinite(v)&&v>=0&&v<=1;
// Python round uses ties to even, unlike JavaScript Math.round.
const round=v=>v%1===.5?2*Math.round(v/2):Math.round(v);
export function printEncoding(readiness,flow,stability){
  if(![readiness,flow,stability].every(valid))return null;
  const rings=Math.max(3,round(flow*PRINT_RULES.ringScale)),weights=[readiness,flow,stability].map(v=>v**PRINT_RULES.mixContrast),total=weights.reduce((a,b)=>a+b,0);
  return {rings,reach:PRINT_RULES.size*.4545*readiness,amplitude:(1-stability)*PRINT_RULES.rippleScale,
    accent:Math.max(0,Math.min(rings-1,round(rings*flow)-1)),shares:weights.map(v=>total?v/total:0)};
}
function ringPoints(radius,amp,index){
  const center=PRINT_RULES.size/2;
  return Array.from({length:PRINT_RULES.points+1},(_,j)=>{
    const t=j/PRINT_RULES.points*2*Math.PI-Math.PI/2;
    const ripple=HARMONICS.reduce((sum,[k,phase,w])=>sum+w*Math.sin(k*t+phase+index*.09),0),r=radius*(1+amp*ripple);
    return [center+r*Math.cos(t),center+r*Math.sin(t)];
  });
}
function mixColor(u,shares){
  const centers=[shares[0]/2,shares[0]+shares[1]/2,shares[0]+shares[1]+shares[2]/2],rgb=[0,0,0];let total=0;
  for(let j=0;j<3;j++){
    if(!shares[j])continue; // A zero component owns no arc.
    for(const wrap of [-1,0,1]){
      const d=(u-centers[j]-wrap)/(shares[j]*.42),w=Math.exp(-d*d);total+=w;
      for(let c=0;c<3;c++)rgb[c]+=COLORS[j][c]*w;
    }
  }
  return total?'#'+rgb.map(c=>round(c/total).toString(16).padStart(2,'0')).join(''):INK;
}
export const printPath=points=>'M'+points.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
export function presencePrintFrame(readiness,flow,stability){
  const e=printEncoding(readiness,flow,stability);if(!e)return null;
  const rings=Array.from({length:PRINT_RULES.ringScale},(_,i)=>{
    const f=Math.min(i+1,e.rings)/e.rings;
    return {points:ringPoints(e.reach*f**PRINT_RULES.ringCurve,e.amplitude*f,Math.min(i,e.rings-1)),opacity:i<e.rings&&i!==e.accent?Number(((.22+.5*f)*.6).toFixed(2)):0};
  });
  const f=(e.accent+1)/e.rings;
  return {rings,accentPoints:ringPoints(e.reach*f**PRINT_RULES.ringCurve,e.amplitude*f,e.accent),colors:Array.from({length:PRINT_RULES.points},(_,j)=>{
    const color=mixColor((j+.5)/PRINT_RULES.points,e.shares);return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  })};
}
export function interpolatePrintFrames(from,to,t){
  const lerp=(a,b)=>a+(b-a)*t,points=(a,b)=>a.map((p,i)=>p.map((v,j)=>lerp(v,b[i][j])));
  return {rings:from.rings.map((ring,i)=>({points:points(ring.points,to.rings[i].points),opacity:lerp(ring.opacity,to.rings[i].opacity)})),accentPoints:points(from.accentPoints,to.accentPoints),colors:points(from.colors,to.colors)};
}
// Decorative, deterministic ticks: identical across observations and outside the ambient glow.
function referenceTicks(center,radius){
  const count=96,point=t=>`${(center+radius*Math.cos(t)).toFixed(2)},${(center+radius*Math.sin(t)).toFixed(2)}`;
  const ticks=Array.from({length:count},(_,i)=>{
    const length=3+6*((i*37%97)/96),opacity=.10+.20*((i*53%101)/100);
    const angle=i/count*2*Math.PI-Math.PI/2,half=length/radius/2;
    return `<path data-pulse-tick d="M${point(angle-half)} A${radius.toFixed(1)},${radius.toFixed(1)} 0 0 1 ${point(angle+half)}" stroke-opacity="${opacity.toFixed(3)}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  return `<g data-pulse-reference data-reference-radius="${radius.toFixed(1)}" fill="none" stroke="var(--pulse-ink,${INK})" stroke-width="0.8">${ticks}</g>`;
}
export function presencePrintSvg(readiness,flow,stability,{animationSlots=false}={}){
  const encoding=printEncoding(readiness,flow,stability);if(!encoding)return '';
  const {size,padding,points,ringCurve,accentWidth}=PRINT_RULES,center=size/2,maxReach=size*.4545;
  const {rings,reach,amplitude,accent,shares}=encoding;
  const parts=[`<rect x="${-padding}" y="${-padding}" width="${size+2*padding}" height="${size+2*padding}" fill="var(--pulse-paper,${PAPER})"/>`,
    referenceTicks(center,maxReach),
    '<g data-pulse-form>'];
  let accentPoints;
  for(let i=0;i<(animationSlots?PRINT_RULES.ringScale:rings);i++){
    const f=Math.min(i+1,rings)/rings,pts=ringPoints(reach*f**ringCurve,amplitude*f,Math.min(i,rings-1));
    if(i===accent){accentPoints=pts;if(!animationSlots)continue;}
    parts.push(`<path data-print-ring="${i}" d="${printPath(pts)} Z" fill="none" stroke="var(--pulse-ink,${INK})" stroke-width="1.4" stroke-opacity="${(i>=rings||i===accent?0:(.22+.5*f)*.6).toFixed(2)}" style="${printBreathStyle(f,stability)}"/>`);
  }
  parts.push(`<g data-print-accent style="${printBreathStyle((accent+1)/rings,stability)}" fill="none" stroke-width="${accentWidth}" stroke-linecap="round">${Array.from({length:points},(_,j)=>`<path d="${printPath([accentPoints[j],accentPoints[j+1]])}" stroke="${mixColor((j+.5)/points,shares)}"/>`).join('')}</g>`);
  parts.push(`<circle data-pulse-core cx="${center}" cy="${center}" r="7" fill="var(--pulse-ink,${INK})"/></g>`);
  // Fixed padding keeps maximum ripple inside the SVG without rescaling individual observations.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padding} ${-padding} ${size+2*padding} ${size+2*padding}" width="${size}" height="${size}" role="img" aria-label="Presence Pulse: readiness ${readiness.toFixed(3)}, flow ${flow.toFixed(3)}, stability ${stability.toFixed(3)}"><desc>Flow sets ring count; readiness sets reach; stability sets edge ripple. Color blends readiness, flow and stability shares raised to power six. Dashed circle: readiness 1.0. Seeded texture is illustrative, not measured subsignals.</desc>${parts.join('')}</svg>`;
}

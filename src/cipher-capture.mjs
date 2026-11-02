// Consumer-side minimization of Cipher 3 desktop metadata, not sensing logic.
// Source contract: Open Presence docs/KEYBOARD_CAPTURE_PAYLOAD.md.
const context={season:['Winter','Spring','Summer','Fall'],time:['Morning','Afternoon','Evening','Night'],weekday:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']};
const types=new Set(['an','pt','md','sp','bk','em','en','ukn']);
const fields=new Set(['appContext','emojis','keyAreas','keyTypes','pressTimes','releaseTimes','length','sessionID','startUnixTime','season','time','timeZone','weekday']);
export function minimizeDesktopCipher(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.has(k)))throw Error('cipher_capture_invalid');
 const n=value.keyTypes?.length;if(!Number.isSafeInteger(n)||n<1||n>2000)throw Error('cipher_capture_invalid');
 if(![value.pressTimes,value.releaseTimes,value.keyAreas].every(a=>Array.isArray(a)&&a.length===n&&a.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))||!value.keyTypes.every(v=>types.has(v)))throw Error('cipher_capture_invalid');
 if(value.length!==n||typeof value.sessionID!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.sessionID)||typeof value.startUnixTime!=='number'||!Number.isFinite(value.startUnixTime)||value.startUnixTime<=0||!Number.isFinite(value.timeZone)||Math.abs(value.timeZone)>24)throw Error('cipher_capture_invalid');
 const out={keyAreas:[...value.keyAreas],keyTypes:[...value.keyTypes],pressTimes:[...value.pressTimes],releaseTimes:[...value.releaseTimes],length:n,sessionID:value.sessionID,startUnixTime:value.startUnixTime,timeZone:value.timeZone};
 for(const [k,allowed]of Object.entries(context)){if(!allowed.includes(value[k]))throw Error('cipher_capture_invalid');out[k]=value[k];}
 return out;
}

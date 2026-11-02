import {readFileSync} from 'node:fs';
export const collaborationPolicy=JSON.parse(readFileSync(new URL('./collaboration-policy.json',import.meta.url),'utf8'));
export function executableGuidance(c){
 const p=collaborationPolicy;
 if(!Object.hasOwn(p.extent,c?.response_extent)||!Object.hasOwn(p.timing,c?.unsolicited_update)||!Object.hasOwn(p.style,c?.conversation_style))throw Error('Unsupported canonical controls');
 return [p.timing[c.unsolicited_update],p.extent[c.response_extent],p.style[c.conversation_style]].join('\n');
}

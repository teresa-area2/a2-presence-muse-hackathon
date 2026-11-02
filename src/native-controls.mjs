// Stable bundled reminder roster of the qualified Muse1.4.13 build.
// Per-process overrides only; preserve the normal native approval/sandbox.
export const REMINDER_IDS = Object.freeze(['memory','skill-reminder','todo-reminder','goal-reminder','verify-reminder','scope-reminder']);
export function nativeControls(base = []) {
  const result=[];
  for(let i=0;i<base.length;i+=2) {
    if(base[i]!=='-c'||typeof base[i+1]!=='string')throw Error('native_control_shape');
    if(!base[i+1].startsWith('runtime_capabilities.plugin:tbh-reminders:reminder:')) result.push(base[i],base[i+1]);
  }
  for(const id of REMINDER_IDS) result.push('-c',`runtime_capabilities.plugin:tbh-reminders:reminder:${id}.enabled=false`);
  return result;
}

import {CODING_TASKS,DEFAULT_CODING_TASK,workspaceTaskSpec,requireWorkspaceTaskId,FREE_CODING_TASK} from '../src/coding-task-catalog.mjs';
import {comparisonModelUnlocked} from './comparison-model-control.mjs';
export function mountCodingTask(select){
 let supported=false,pending=null;
 return {configure(config){supported=config?.default_task===DEFAULT_CODING_TASK&&Array.isArray(config.tasks)&&[CODING_TASKS.length,CODING_TASKS.length+1].includes(config.tasks.length)&&config.tasks.every(t=>CODING_TASKS.some(s=>s.id===t?.id)||t?.id===FREE_CODING_TASK.id)&&CODING_TASKS.every(t=>config.tasks.filter(x=>x?.id===t.id).length===1);select.closest?.('.coding-task-control')?.toggleAttribute('hidden',!supported);if(supported){select.value=config.default_task;const free=select.querySelector?.('[value=free-task]');if(free)free.disabled=!config.tasks.some(t=>t.id===FREE_CODING_TASK.id);}},
 supported(){return supported;},value(){pending=requireWorkspaceTaskId(select.value);return pending;},
 render(context){if(!supported){select.disabled=true;return null;}const unlocked=comparisonModelUnlocked({...context,supported});select.disabled=!unlocked;if(context.starting&&pending)select.value=pending;else if(!unlocked&&context.state?.selected_task)select.value=requireWorkspaceTaskId(context.state.selected_task);return workspaceTaskSpec(select.value);}};
}

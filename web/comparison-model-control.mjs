import {COMPARISON_MODELS,requireComparisonModel} from '../src/comparison-model.mjs';
export function comparisonModelUnlocked({connected,starting,stopping,state,supported}){return supported===true&&connected===true&&!starting&&!stopping&&['idle','closed'].includes(state?.status)&&state?.error!=='cleanup_unconfirmed';}
export function mountComparisonModel(select){
 let supported=false,pending=null;
 return {configure(config){supported=config?.matched===true&&Array.isArray(config.models)&&COMPARISON_MODELS.every(m=>config.models.some(x=>x?.id===m.id));select.hidden=!supported;},
 value(){pending=requireComparisonModel(select.value);return pending;},
 render(context){const unlocked=comparisonModelUnlocked({...context,supported});select.disabled=!unlocked;if(context.starting&&pending)select.value=pending;else if(!unlocked&&context.state?.comparison_model)select.value=requireComparisonModel(context.state.comparison_model);},
 supported(){return supported;}};
}

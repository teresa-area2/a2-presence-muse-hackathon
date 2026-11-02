// Explicit local export only. Rendering never dispatches a model or an export.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
export function evidencePackageHtml(){return `<section id="evidence-package-export" aria-label="Combined evidence export">
 <h3>Evidence package</h3>
 <p class="footnote">Save the checkpoint, Presence history and any available impact assessment locally. No model call. Assessment text may contain private task details; full conversations and work-file contents are excluded.</p>
 <div class="evidence-package-actions"><label><input id="evidence-package-excerpts" type="checkbox"> Include quoted public excerpts</label><button id="export-evidence-package" type="button" disabled>Export evidence package</button></div>
 <p id="evidence-package-status" class="footnote" role="status" aria-live="polite"></p>
</section>`;}

export function mountEvidencePackage(container,{save}={}){
 if(!container||typeof save!=='function')throw Error('evidence_package_ui_invalid');
 const button=container.querySelector('#export-evidence-package'),excerpts=container.querySelector('#evidence-package-excerpts'),status=container.querySelector('#evidence-package-status');
 if(!button||!excerpts||!status)throw Error('evidence_package_ui_invalid');
 let current=null,connected=false,pending=false,enabled=false;
 const identity=state=>JSON.stringify([state?.session_generation,state?.evidence?.run_id]);
 function render(state,options={}){
  if(identity(state)!==identity(current)&&!pending)status.textContent='';
  current=state;connected=options.connected===true;
  button.disabled=!enabled||!connected||pending||!uuid(state?.evidence?.run_id)||!count(state?.session_generation)||state.session_generation<1||!['saved','saving'].includes(state?.evidence?.status);
  excerpts.disabled=pending;if(!enabled&&!pending)status.textContent='Local evidence-package output is unavailable in this workspace.';
 }
 button.addEventListener('click',async()=>{
  if(button.disabled||pending)return;
  const selected={generation:current.session_generation,run_id:current.evidence.run_id,revision:current.evidence.revision};
  pending=true;status.textContent='Saving evidence package…';render(current,{connected});
  try{
   const result=await save({generation:selected.generation,run_id:selected.run_id,include_public_excerpts:excerpts.checked===true});
   const receipt=result?.saved;
   if(result?.ok!==true||!receipt||receipt.run_id!==selected.run_id||receipt.session_generation!==selected.generation||!count(receipt.revision)||receipt.revision<selected.revision||typeof receipt.path!=='string'||!receipt.path.startsWith('/')||receipt.path.length>4096||/[\x00-\x1f\x7f]/.test(receipt.path)||!(/^[a-f0-9]{64}$/).test(receipt.sha256??'')||!count(receipt.bytes)||receipt.bytes<1)throw Error('evidence_package_receipt_invalid');
   const earlier=current?.session_generation!==selected.generation||current?.evidence?.run_id!==selected.run_id;
   status.textContent=(earlier?'Saved for the earlier comparison: ':'Saved: ')+receipt.path+(result.newer_evidence_available===true||!earlier&&current.evidence?.revision>receipt.revision?' · Newer evidence is available.':'');
  }catch(error){
   const possible=error?.possibly_saved;
   if(error?.message==='evidence_publication_unconfirmed'&&possible?.run_id===selected.run_id&&possible?.session_generation===selected.generation&&uuid(possible.package_id)&&typeof possible.path==='string'&&possible.path.startsWith('/')&&possible.path.length<=4096&&!/[\x00-\x1f\x7f]/.test(possible.path)){
    status.textContent='A file may exist at '+possible.path+'; save durability was not confirmed. Check that file before exporting again.';return;
   }
   if(error?.message==='evidence_output_configuration_changed'){status.textContent='Saving is blocked because the output settings changed. Your comparison is preserved. Ask the maintainer to check the workspace output configuration.';return;}
   const changed=['evidence_package_changed','evidence_generation_mismatch','measurement_generation_mismatch'].includes(error?.message);
   status.textContent=changed?'The evidence changed before saving. Export again for the current comparison.':'Evidence package was not confirmed saved. Check the connection and local output configuration, then try again.';
  }finally{pending=false;render(current,{connected});}
 });
 return{configure(config){enabled=config?.enabled===true;if(!enabled)status.textContent='Local evidence-package output is unavailable in this workspace.';render(current,{connected});},render};
}

export async function saveEdit(client,id,draft,revision){
 const patch={...draft};
 try{return await client.save(id,{...patch},revision)}catch(error){
  if(error?.code!=='CONFLICT')throw error;
  const current=await client.get(id);
  return client.save(id,{...current.fields,...patch},current.revision);
 }
}

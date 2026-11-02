// Full-text rolling transcript is separate from the policy's visible summaries.
export function transcriptNotice(count){
  if(!Number.isSafeInteger(count)||count<=0)return '';
  return `${count} earlier full message${count===1?' was':'s were'} omitted from the retained transcript. Summaries may still appear.`;
}
export function routineSummaryNotice(count){
  if(!Number.isSafeInteger(count)||count<=0)return '';
  return `${count} routine summar${count===1?'y was':'ies were'} omitted from the bounded view. Required notices remain visible.`;
}
// Small, inert Markdown renderer for untrusted agent output. Never parses HTML.
const MAX_LENGTH=200000;
const token=/(`[^`\n]{1,512}`|\*\*[^*\n]{1,512}\*\*|__[^_\n]{1,512}__|\*[^*\n]{1,512}\*|_[^_\n]{1,512}_|\[[^\]\n]{1,256}\]\([^\s)]{1,1024}\))/g;
function inline(doc,target,value){
  let last=0;token.lastIndex=0;
  for(const match of value.matchAll(token)){
    if(match.index>last)target.append(doc.createTextNode(value.slice(last,match.index)));
    const t=match[0];let el;
    if(t.startsWith('`')){el=doc.createElement('code');el.textContent=t.slice(1,-1);}
    else if(t.startsWith('**')||t.startsWith('__')){el=doc.createElement('strong');el.textContent=t.slice(2,-2);}
    else if(t.startsWith('*')||t.startsWith('_')){el=doc.createElement('em');el.textContent=t.slice(1,-1);}
    else{
      const at=t.lastIndexOf(']('),label=t.slice(1,at),address=t.slice(at+2,-1);let safe=false;
      try{safe=['http:','https:','mailto:'].includes(new URL(address).protocol);}catch{}
      if(safe){el=doc.createElement('a');el.href=address;el.rel='noopener noreferrer';el.target='_blank';el.textContent=label;}
      else el=doc.createTextNode(t);
    }
    target.append(el);last=match.index+t.length;
  }
  if(last<value.length)target.append(doc.createTextNode(value.slice(last)));
}
// Parse only inert GFM comparison rows. Pipes inside code or escaped pipes
// belong to cell text; a separator row is required before a table is created.
function tableCells(line){
  if(!line.includes('|'))return null;
  const cells=[];let cell='',fence=0;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='\\'&&line[i+1]==='|'){cell+='|';i++;continue;}
    if(ch==='`'){let end=i+1;while(line[end]==='`')end++;const size=end-i;cell+=line.slice(i,end);if(!fence)fence=size;else if(size===fence)fence=0;i=end-1;continue;}
    if(ch==='|'&&!fence){cells.push(cell.trim());cell='';}else cell+=ch;
  }
  cells.push(cell.trim());if(cells[0]==='')cells.shift();if(cells.at(-1)==='')cells.pop();return cells;
}
export function renderMarkdown(doc,input){
  const root=doc.createDocumentFragment(),lines=String(input??'').slice(0,MAX_LENGTH).replace(/\r\n?/g,'\n').split('\n');let i=0;
  const startsBlock=line=>/^\s{0,3}(```|~~~|#{1,6}\s|[-+*]\s+|\d+[.)]\s+|>)/.test(line);
  const tableAt=index=>{const header=tableCells(lines[index]??''),rule=tableCells(lines[index+1]??'');return header&&header.length>=2&&header.length<=16&&rule?.length===header.length&&rule.every(cell=>/^:?-{3,}:?$/.test(cell))?header:null;};
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=line.match(/^\s{0,3}(```+|~~~+)([^\n]*)$/);
    if(fence){const mark=fence[1],body=[];i++;while(i<lines.length&&!new RegExp('^\\s{0,3}'+mark[0]+'{'+mark.length+',}\\s*$').test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;const pre=doc.createElement('pre'),code=doc.createElement('code');code.textContent=body.join('\n');pre.append(code);root.append(pre);continue;}
    if(/^\s{0,3}>/.test(line)){
      const quote=doc.createElement('blockquote'),p=doc.createElement('p');let count=0;
      while(i<lines.length&&/^\s{0,3}>/.test(lines[i])){if(count++)p.append(doc.createElement('br'));inline(doc,p,lines[i++].replace(/^\s{0,3}> ?/,''));}
      quote.append(p);root.append(quote);continue;
    }
    const header=tableAt(i);
    if(header){
      const table=doc.createElement('table'),head=doc.createElement('thead'),row=doc.createElement('tr'),body=doc.createElement('tbody');
      for(const value of header){const cell=doc.createElement('th');cell.setAttribute('scope','col');inline(doc,cell,value);row.append(cell);}head.append(row);table.append(head,body);i+=2;
      while(i<lines.length&&lines[i].trim()){
        const values=tableCells(lines[i]);if(values?.length!==header.length)break;
        const next=doc.createElement('tr');for(const value of values){const cell=doc.createElement('td');inline(doc,cell,value);next.append(cell);}body.append(next);i++;
      }
      root.append(table);continue;
    }
    const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading){const h=doc.createElement('h'+Math.min(6,heading[1].length+2));inline(doc,h,heading[2]);root.append(h);i++;continue;}
    const bullet=line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if(bullet){const ordered=/^\d/.test(bullet[1]),list=doc.createElement(ordered?'ol':'ul');
      while(i<lines.length){const m=lines[i].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);if(!m||/^\d/.test(m[1])!==ordered)break;const li=doc.createElement('li');inline(doc,li,m[2]);list.append(li);i++;}root.append(list);continue;}
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!startsBlock(lines[i])&&!tableAt(i))paragraph.push(lines[i++]);const p=doc.createElement('p');paragraph.forEach((text,index)=>{if(index)p.append(doc.createElement('br'));inline(doc,p,text);});root.append(p);
  }
  return root;
}

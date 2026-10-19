const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// A deliberately small Markdown subset. Raw HTML and external images stay text.
function inline(value) {
  return value.split(/(`[^`\n]+`)/g).map((part,i) => i%2 ? `<code>${escape(part.slice(1,-1))}</code>` : escape(part)
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,'<em>$1</em>')).join('');
}
export function readingHTML(content) {
  const lines=content.replace(/\r\n?/g,'\n').split('\n'), out=[];
  let paragraph=[], list=[], listType='', quote=[], code=null, fence='';
  const flush=()=>{
    if(paragraph.length){out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);paragraph=[];}
    if(list.length){out.push(`<${listType}>${list.map(x=>`<li>${inline(x)}</li>`).join('')}</${listType}>`);list=[];}
    if(quote.length){out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);quote=[];}
  };
  for(const line of lines){
    if(code!==null){if(line.trim()===fence){out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);code=null;}else code.push(line);continue;}
    const f=/^(`{3,}|~{3,})[^`~]*$/.exec(line);
    if(f){flush();fence=f[1];code=[];continue;}
    if(!line.trim()){flush();continue;}
    const h=/^(#{1,6})\s+(.+)$/.exec(line), li=/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line), q=/^>\s?(.*)$/.exec(line);
    if(h){flush();const level=Math.min(6,h[1].length+1);out.push(`<h${level}>${inline(h[2])}</h${level}>`);}
    else if(li){const type=li[1]?'ul':'ol';if(paragraph.length||quote.length||(list.length&&listType!==type))flush();listType=type;list.push(li[2]);}
    else if(q){if(paragraph.length||list.length)flush();quote.push(q[1]);}
    else if(/^\s*(---+|\*\*\*+)\s*$/.test(line)){flush();out.push('<hr>');}
    else{if(list.length||quote.length)flush();paragraph.push(line);}
  }
  flush();if(code!==null)out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
  return out.join('');
}

export function monthDays(month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Invalid month');
  const [year,m]=month.split('-').map(Number);
  const first=new Date(0);first.setUTCFullYear(year,m-1,1);first.setUTCHours(12,0,0,0);
  const end=new Date(first);end.setUTCMonth(m,0);
  return {offset:first.getUTCDay(),days:Array.from({length:end.getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)};
}
export function moveMonth(month,delta) {
  monthDays(month);
  const [year,m]=month.split('-').map(Number),date=new Date(0);
  date.setUTCFullYear(year,m-1+delta,1);
  const nextYear=date.getUTCFullYear();
  return nextYear<1||nextYear>9999?month:`${String(nextYear).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
}
export function photoType(bytes) {
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  const str=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
  if(['GIF87a','GIF89a'].includes(str(0,6)))return 'image/gif';
  if(str(0,4)==='RIFF'&&str(8,12)==='WEBP')return 'image/webp';
  return '';
}

export function caseInsensitiveGlob(value:string){
 return '*'+Array.from(value.normalize('NFC')).map(c=>c==='*'?'[*]':c==='?'?'[?]':c==='['?'[[]':c.toLowerCase()!==c.toUpperCase()?`[${c.toLowerCase()}${c.toUpperCase()}]`:c).join('')+'*';
}
// D1 limits LIKE/GLOB patterns to 50 bytes. Match long names in bounded pieces,
// checking adjacent character positions so pieces cannot match unrelated words.
export function searchMatch(expression:string,value:string){
 const normalized=value.normalize('NFC'),pattern=caseInsensitiveGlob(normalized);
 if(Buffer.byteLength(pattern)<=50)return{sql:`${expression} GLOB ?`,args:[pattern]};
 const chunks:{offset:number;length:number;pattern:string}[]=[];let part='',offset=0;
 const flush=()=>{if(part){chunks.push({offset,length:Array.from(part).length,pattern:caseInsensitiveGlob(part).slice(1,-1)});offset+=Array.from(part).length;part='';}};
 for(const c of Array.from(normalized)){if(part&&Buffer.byteLength(caseInsensitiveGlob(part+c))>44)flush();part+=c;}flush();
 return {sql:`(${expression} GLOB ? AND EXISTS(WITH RECURSIVE _search_positions(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM _search_positions WHERE n<length(${expression})-?+1) SELECT 1 FROM _search_positions WHERE NOT EXISTS(SELECT 1 FROM json_each(?) _search_chunk WHERE substr(${expression},n+json_extract(_search_chunk.value,'$.offset'),json_extract(_search_chunk.value,'$.length')) NOT GLOB json_extract(_search_chunk.value,'$.pattern'))))`,args:['*'+chunks[0].pattern+'*',Array.from(normalized).length,JSON.stringify(chunks)]};
}

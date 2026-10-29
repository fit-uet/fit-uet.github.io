// D1 allows fewer compound SELECT terms than regular SQLite. Materialized groups
// keep the read in one statement/snapshot without flattening past that limit.
export function compoundSelect(selects:string[],ctes=''){
 let parts=selects.map(s=>s.trim()).filter(Boolean);const groups:string[]=[];let index=0;
 if(!parts.length)throw Error('A compound read needs at least one SELECT');
 while(parts.length>4){const next:string[]=[];for(let start=0;start<parts.length;start+=4){const name=`_read_union_${index++}`;groups.push(`${name} AS MATERIALIZED (${parts.slice(start,start+4).join(' UNION ALL ')})`);next.push(`SELECT * FROM ${name}`);}parts=next;}
 const prefix=ctes?(ctes+(groups.length?', '+groups.join(', '):'')):(groups.length?'WITH '+groups.join(', '):'');
 return (prefix?prefix+'\n':'')+parts.join(' UNION ALL ');
}

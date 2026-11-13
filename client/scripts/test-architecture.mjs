// Source-map invariants: a broken edge or missing source must not ship silently.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'client/src/architecture/model.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {COMPONENTS,MECHANISMS,NODE,STRATEGIES,neighbors,getMechanism}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
assert.equal(new Set(COMPONENTS.map(n=>n.id)).size,COMPONENTS.length,'Unique component IDs');
assert.equal(new Set(MECHANISMS.map(n=>n.id)).size,MECHANISMS.length,'Unique mechanism IDs');
for(const n of COMPONENTS){
  for(const field of ['name','purpose','inputs','outputs'])assert.ok(n[field],`${n.id}: ${field}`);
  assert.ok(n.sources.length,`${n.id} has evidence`);
  for(const ref of n.sources){
    const [path,symbol]=ref.split(':');assert.ok(existsSync(resolve(root,path)),`${n.id}: missing ${path}`);
    if(symbol)assert.ok(readFileSync(resolve(root,path),'utf8').includes(symbol),`${path}: missing source symbol ${symbol}`);
  }
  if(n.status!=='implemented')assert.ok(n.caveat,`${n.id}: explain status`);
}
for(const m of MECHANISMS){
  assert.ok(m.nodes.length&&m.steps.length,`${m.id}: complete scene`);
  assert.equal(new Set(m.nodes).size,m.nodes.length,`${m.id}: no duplicate nodes`);
  m.nodes.forEach(id=>assert.ok(NODE[id],`${m.id}: unknown ${id}`));
  m.flows.forEach(e=>{assert.ok(m.nodes.includes(e.from)&&m.nodes.includes(e.to),`${m.id}: dangling ${e.from} → ${e.to}`);assert.notEqual(e.from,e.to);assert.ok(e.label);});
  m.steps.forEach(s=>{assert.ok(s.text&&s.nodes.length);s.nodes.forEach(id=>assert.ok(m.nodes.includes(id),`${m.id}: walkthrough node ${id} missing`));});
  m.related.forEach(id=>assert.ok(MECHANISMS.some(x=>x.id===id),`${m.id}: broken related link`));
  for(const edge of m.flows){assert.ok(neighbors(m,edge.from).has(edge.to));assert.ok(neighbors(m,edge.to).has(edge.from));}
}
const overview=getMechanism('overview'), fast=getMechanism('fast-desk');
assert.ok(overview.nodes.includes('fast'),'The parallel desk remains visible');
assert.ok(overview.steps.every(s=>!s.nodes.includes('fast')),'The AI story cannot sequence into the parallel desk');
assert.match(overview.steps.at(-1).title,/review.*wait/i,'AI cycle ends at review and scheduler wait');
assert.ok(overview.flows.some(e=>e.from==='runtime'&&e.to==='floor'));
assert.ok(overview.flows.some(e=>e.from==='runtime'&&e.to==='fast'));
for(const m of [overview,fast]){
  assert.ok(m.flows.filter(e=>e.from==='fast'||e.to==='fast').every(e=>['runtime','alpaca','ledger','traces','fast'].includes(e.from)&&['runtime','alpaca','ledger','traces','fast'].includes(e.to)),'Rules desk connects only to its launcher and genuine shared infrastructure');
}
assert.ok(fast.steps.length>1&&fast.steps[0].nodes.includes('runtime'));
assert.equal(NODE.zoro.subtitle,'Value investing');assert.equal(NODE.sanji.subtitle,'Global macro');
assert.equal(NODE.fast.name,'Jinbe + Law');
assert.equal(getMechanism('missing').id,'overview');
assert.equal(STRATEGIES.length,5);assert.deepEqual(STRATEGIES.map(s=>s.name),['Robin','Nami','Zoro','Sanji','Luffy']);
assert.equal(NODE.failure.status,'planned');assert.equal(NODE.learning.status,'planned');assert.equal(NODE.validation.status,'limited');
assert.ok(NODE.fast.caveat.includes('No model'));
const nav=readFileSync(resolve(root,'client/src/nav.ts'),'utf8');
assert.ok(nav.indexOf('path: "/architecture"')<nav.indexOf('label: "Lab"'),'Architecture is outside Lab');
console.log(`Architecture verified: ${COMPONENTS.length} contracts, ${MECHANISMS.length} scenes, ${MECHANISMS.reduce((a,m)=>a+m.flows.length,0)} valid directed edges, source references and status labels.`);
const traceJs=ts.transpileModule(readFileSync(resolve(root,'client/src/architecture/trace.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {traceRows}=await import(`data:text/javascript;base64,${Buffer.from(traceJs).toString('base64')}`);
const span=(id,parent_id,depth)=>({id,parent_id,depth,name:id,type:'function',offset_ms:0,duration_ms:100,error:null});
const overlapping=[span('root',null,0),span('a','root',1),span('b','root',1),span('aa','a',2),span('bb','b',2)];
assert.deepEqual(traceRows(overlapping,new Set()).map(r=>r.span.id),['root','a','aa','b','bb'],'Group overlapping calls by actual parent');
assert.deepEqual(traceRows(overlapping,new Set(['a'])).map(r=>r.span.id),['root','a','b','bb'],'Collapsing a call preserves another call’s children');
assert.equal(traceRows([span('a','b',1),span('b','a',1)],new Set()).length,2,'Malformed cycle cannot recurse forever');
assert.equal(traceRows([span('a',undefined,3)],new Set())[0].hasChildren,false,'Old API never invents parent relationships');
console.log('Trace nesting verified: overlapping calls, collapse, malformed cycles and older API compatibility.');

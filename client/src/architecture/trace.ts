import type { TimelineSpan } from '../api';
export interface TraceRow { span: TimelineSpan; depth: number; hasChildren: boolean }
/** Parent IDs, not chronological adjacency, define a tree when tools overlap. */
export function traceRows(spans: TimelineSpan[], collapsed: ReadonlySet<string>): TraceRow[] {
  if(!spans.some(s=>s.parent_id!==undefined))return spans.map(span=>({span,depth:span.depth,hasChildren:false}));
  const ids=new Set(spans.map(s=>s.id));
  const children=new Map<string,TimelineSpan[]>();
  const roots:TimelineSpan[]=[];
  for(const span of spans){
    if(span.parent_id&&span.parent_id!==span.id&&ids.has(span.parent_id)){
      const list=children.get(span.parent_id)??[];list.push(span);children.set(span.parent_id,list);
    }else roots.push(span);
  }
  const result:TraceRow[]=[];const visited=new Set<string>();const hidden=new Set<string>();
  function hide(id:string){if(hidden.has(id))return;hidden.add(id);(children.get(id)??[]).forEach(s=>hide(s.id));}
  function visit(span:TimelineSpan,depth:number){
    if(visited.has(span.id)||hidden.has(span.id))return;visited.add(span.id);
    const kids=children.get(span.id)??[];result.push({span,depth,hasChildren:!!kids.length});
    if(collapsed.has(span.id))kids.forEach(s=>hide(s.id));else kids.forEach(s=>visit(s,depth+1));
  }
  roots.forEach(s=>visit(s,0));
  // Malformed cycles cannot hang the explorer or silently lose evidence.
  spans.forEach(s=>{if(!visited.has(s.id)&&!hidden.has(s.id))visit(s,0);});
  return result;
}

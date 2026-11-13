import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getRun, getRuns, type TimelineSpan } from '../api';
import { NODE, STRATEGIES, type Mechanism } from './model';
import { traceRows } from './trace';

export function TraceInspector() {
  const [enabled,setEnabled]=useState(false);
  const [trace,setTrace]=useState('');const [selected,setSelected]=useState<TimelineSpan|null>(null);
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const runs=useQuery({queryKey:['architecture-runs'],queryFn:()=>getRuns(),enabled,staleTime:30000});
  const detail=useQuery({queryKey:['architecture-run',trace],queryFn:()=>getRun(trace),enabled:!!trace,staleTime:30000});
  const spans=detail.data?.timeline??[];
  const max=Math.max(1,...spans.map(s=>(s.offset_ms??0)+(s.duration_ms??0)));
  const visible=useMemo(()=>traceRows(spans,collapsed),[spans,collapsed]);
  const ms=(n:number|null)=>n===null?'Not recorded':n<1000?`${Math.round(n)} ms`:`${(n/1000).toFixed(2)} s`;
  return <section className="am-detail-tool" aria-labelledby="trace-heading">
    <div className="am-tool-heading"><div><span className="am-eyebrow">Actual saved evidence</span><h3 id="trace-heading">Open the execution tree.</h3></div><button className="am-button" onClick={()=>{setEnabled(true);if(enabled)void runs.refetch();}}>{enabled?'Refresh runs':'Load saved runs'}</button></div>
    <p>This optional inspector reads saved traces. It does not run an agent. Missing timing stays missing; the 3D traffic above is illustrative.</p>
    {enabled&&runs.isLoading&&<p role="status">Loading saved runs…</p>}
    {runs.isError&&<p role="alert">Saved traces are unavailable. The architecture explorer still works. Check that the API is reachable, then refresh.</p>}
    {runs.data&&!runs.data.length&&<p>No saved runs yet.</p>}
    {!!runs.data?.length&&<label className="am-field">Saved run<select value={trace} onChange={e=>{setTrace(e.target.value);setSelected(null);setCollapsed(new Set());}}><option value="">Choose a run</option>{runs.data.map(r=><option value={r.trace_id} key={r.trace_id}>{r.trader} · {r.mode} · {r.started_at??r.trace_id}{r.error?' · error':''}</option>)}</select></label>}
    {detail.isFetching&&<p role="status">Reading trace…</p>}
    {detail.isError&&<p role="alert">This run could not be loaded. Choose another run or try again.</p>}
    {detail.data&&<>
      <div className="am-trace-meta"><code>{detail.data.trace_id}</code><span>{spans.length} spans · {ms(max)} recorded extent</span></div>
      {detail.data.error&&<p className="am-caution">Run error: {detail.data.error}</p>}
      {!!spans.length&&!spans.some(s=>s.parent_id!==undefined)&&<p className="am-fine">This API provides depth-only timing. Parent-based expand/collapse is available after the updated API starts.</p>}
      {!spans.length?<p>No span timeline was recorded for this run.</p>:<div className="am-trace-tree" aria-label="Saved execution spans">
        <div className="am-trace-axis"><span>Calls / recorded nesting</span><span>0 → {ms(max)}</span></div>
        {visible.map(({span,depth,hasChildren})=>{
          return <div className="am-trace-row" key={span.id} data-error={!!span.error}>
            <div className="am-trace-name" style={{paddingLeft:Math.min(depth,6)*14}}>
              {hasChildren?<button aria-expanded={!collapsed.has(span.id)} aria-label={`${collapsed.has(span.id)?'Expand':'Collapse'} ${span.name}`} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(span.id))next.delete(span.id);else next.add(span.id);return next;})}>{collapsed.has(span.id)?'+':'−'}</button>:<span className="am-tree-dot">·</span>}
              <button onClick={()=>setSelected(span)} aria-pressed={selected?.id===span.id}>{span.name||span.type}</button>
            </div>
            <button className="am-trace-track" onClick={()=>setSelected(span)} aria-label={`${span.name}, offset ${ms(span.offset_ms)}, duration ${ms(span.duration_ms)}${span.error?', failed':''}`}>
              {span.offset_ms===null?<span className="am-trace-missing">Timing not recorded</span>:<span className="am-trace-bar" style={{left:`${span.offset_ms/max*100}%`,width:`${Math.max(.5,(span.duration_ms??0)/max*100)}%`}} data-unknown={span.duration_ms===null}/>}
            </button>
          </div>;
        })}
      </div>}
      {selected&&<div className="am-span-detail" aria-live="polite"><strong>{selected.name}</strong><dl><div><dt>Kind</dt><dd>{selected.type}</dd></div><div><dt>Depth</dt><dd>{selected.depth}</dd></div><div><dt>Offset</dt><dd>{ms(selected.offset_ms)}</dd></div><div><dt>Duration</dt><dd>{ms(selected.duration_ms)}</dd></div></dl>{selected.error&&<p>{selected.error.message??'Recorded failure'}</p>}</div>}
      <Link to="/decisions">Open Decisions for research, orders and source checks ↗</Link>
    </>}
  </section>;
}

export function ExperimentMatrix() {
  const [scenarios,setScenarios]=useState(3);const [repeats,setRepeats]=useState(3);
  const [modes,setModes]=useState(['on_demand','off']);const [cell,setCell]=useState(0);
  const choices=[['on_demand','On demand'],['off','Research off'],['forced','Always first'],['digest','Frozen digest']];
  const arms=modes.length,total=scenarios*arms*repeats;
  return <section className="am-detail-tool" aria-labelledby="matrix-heading">
    <div className="am-tool-heading"><div><span className="am-eyebrow">Interactive experiment design</span><h3 id="matrix-heading">See the cost of a fair comparison.</h3></div><div className="am-big-number">{total}<span>planned trials</span></div></div>
    <p>A local planning illustration of <code>plan_trials</code>: repetition → scenario → arm. One fixed model, prompt and strategy; only Researcher mode varies. This does not queue an experiment or invent results.</p>
    <div className="am-matrix-controls"><label className="am-field">Scenarios <strong>{scenarios}</strong><input type="range" min="1" max="6" value={scenarios} onChange={e=>{setScenarios(+e.target.value);setCell(0);}}/></label><label className="am-field">Repetitions <strong>{repeats}</strong><input type="range" min="1" max="8" value={repeats} onChange={e=>{setRepeats(+e.target.value);setCell(0);}}/></label></div>
    <fieldset className="am-mode-options"><legend>Researcher arms</legend>{choices.map(([id,label])=><label key={id}><input type="checkbox" checked={modes.includes(id)} disabled={modes.length===1&&modes[0]===id} onChange={()=>{setCell(0);setModes(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);}}/>{label}</label>)}</fieldset>
    <div className="am-matrix" aria-label="Interleaved trial plan">{Array.from({length:repeats},(_,r)=><div className="am-matrix-round" key={r}><span>R{r+1}</span><div>{Array.from({length:scenarios},(_,sc)=>modes.map((mode,a)=>{const index=r*scenarios*arms+sc*arms+a;return <button key={`${sc}-${mode}`} data-selected={cell===index} style={{'--arm-hue':`${175+a*38}`} as React.CSSProperties} onClick={()=>setCell(index)} aria-pressed={cell===index} aria-label={`Trial ${index+1}, repetition ${r+1}, scenario ${sc+1}, ${mode}`}><span>{sc+1}</span></button>;}))}</div></div>)}</div>
    <p className="am-calculation" aria-live="polite">Trial {cell+1}: repetition {Math.floor(cell/(scenarios*arms))+1} · scenario {Math.floor(cell/arms)%scenarios+1} · {choices.find(c=>c[0]===modes[cell%arms])?.[1]}. Fresh sandbox account; same scenario evidence.</p>
    <p className="am-fine">{scenarios} scenarios × {arms} arms × {repeats} repetitions. Manifests record hashes and configuration; the current worker reloads fixture files. Sampling remains stochastic.</p>
  </section>;
}

export function IntradayInstrument() {
  const [minute,setMinute]=useState(575);const [distance,setDistance]=useState(1);
  const entry=101,equity=10000,cash=10000,stop=entry-distance;
  const shares=Math.max(0,Math.floor(Math.min(.01*equity/(entry-stop),Math.min(.25*equity,cash)/(entry*1.002))));
  const clock=`${Math.floor(minute/60).toString().padStart(2,'0')}:${(minute%60).toString().padStart(2,'0')}`;
  const phase=minute<575?'Opening range forming':minute<870?'Entry window: setup still required':minute<950?'Entries closed; manage positions':minute<960?'Floor attempts liquidation':'Regular session closed';
  return <section className="am-detail-tool" aria-labelledby="intraday-heading">
    <div className="am-tool-heading"><div><span className="am-eyebrow">Interactive code thresholds</span><h3 id="intraday-heading">A strategy with a clock.</h3></div><div className="am-big-number">{clock}<span>New York · illustrative weekday</span></div></div>
    <div className="am-session-track"><div className="am-range-window"/><div className="am-entry-window"/><div className="am-exit-window"/><div className="am-session-needle" style={{left:`${(minute-570)/390*100}%`}}/></div>
    <div className="am-session-labels"><span>09:30<br/>Open</span><span>09:35<br/>Range set</span><span>14:30<br/>Entry cutoff</span><span>15:50<br/>Flatten</span></div>
    <label className="am-field">Scrub session time<input type="range" min="570" max="960" value={minute} onChange={e=>setMinute(+e.target.value)} aria-valuetext={`${clock} New York. ${phase}`}/></label>
    <p className="am-calculation" aria-live="polite">{phase}</p>
    <div className="am-risk-calculator"><div><h4>Risk becomes a share count.</h4><p>Illustrative equity and cash: $10,000. Entry: $101. Change the distance to the range-low stop; the calculation mirrors <code>orb.size</code>.</p><label className="am-field">Entry-to-stop distance: ${distance.toFixed(2)}<input type="range" min=".25" max="8" step=".25" value={distance} onChange={e=>setDistance(+e.target.value)}/></label></div><div className="am-risk-answer" aria-live="polite"><strong>{shares}</strong><span>shares</span><small>min(risk budget, 25% cap, cash)<br/>Stop ${stop.toFixed(2)} · ${Math.round(shares*distance)} nominal risk</small></div></div>
    <p className="am-fine">A sizing illustration, not a trade signal. Actual setups additionally require a bullish opening bar, ≥1.5× relative volume and a break above the high. Stop exits rely on the agent; closing exits rely on the running floor and available quotes.</p>
  </section>;
}

export function GuardrailInstrument({onSelect}:{onSelect:(id:string)=>void}) {
  const [kind,setKind]=useState('enforced');
  const groups=[{id:'enforced',name:'Enforced boundary',node:'accounts',title:'Authority comes from the process.',text:'The orchestrator binds mutation tools to LAB_ACCOUNT. Fixed-playbook agents cannot use change_strategy. Cash, holdings and unavailable-price checks can reject an order.'},{id:'calculated',name:'Calculated guidance',node:'sizing',title:'Correct arithmetic does not force compliance.',text:'size_positions computes caps, volatility scaling and drawdown brakes. Its result is suggested quantities; the generic Account buy/sell methods do not require the agent to follow them.'},{id:'gaps',name:'Known gaps',node:'validation',title:'Make incomplete validation visible.',text:'The live Account methods lack a universal positive-quantity check and full pre-trade playbook enforcement. Lab and fast-desk checks differ. Saved-run rule checks are retrospective.'}];
  const active=groups.find(g=>g.id===kind)!;
  return <section className="am-detail-tool"><span className="am-eyebrow">Three different kinds of protection</span><div className="am-segmented">{groups.map(g=><button key={g.id} aria-pressed={kind===g.id} onClick={()=>{setKind(g.id);onSelect(g.node);}}>{g.name}</button>)}</div><h3>{active.title}</h3><p>{active.text}</p><p className="am-fine">Source audit: server/accounts_server.py, server/accounts.py, server/quant/tools.py and server/playbooks.py. Selecting a boundary only changes this explanation.</p></section>;
}

export function StrategyComparison({navigate}:{navigate:(id:string)=>void}) {
  const [selected,setSelected]=useState('robin');const strategy=STRATEGIES.find(s=>s.id===selected)!;
  return <section className="am-strategies" aria-labelledby="strategy-heading">
    <div className="am-section-heading"><div><span className="am-eyebrow">Five strategies · one shared model</span><h2 id="strategy-heading">Same intelligence. Different instructions.</h2></div><span className="am-section-note">No individual fine-tuning in this repository.</span></div>
    <div className="am-strategy-tabs">{STRATEGIES.map(s=><button key={s.id} onClick={()=>setSelected(s.id)} aria-pressed={selected===s.id} style={{'--trader-color':`var(--t-${s.id})`} as React.CSSProperties}><span className="am-strategy-glyph">{s.name.slice(0,1)}</span><strong>{s.name}</strong><span>{s.style}</span></button>)}</div>
    <div className="am-strategy-detail"><div><span className="am-eyebrow">{strategy.name} / {strategy.style}</span><h3>{strategy.difference}</h3><p>{NODE[strategy.id].purpose}</p></div><dl><div><dt>Inputs</dt><dd>{strategy.input}</dd></div><div><dt>Decision path</dt><dd>{strategy.process}</dd></div><div><dt>Tools</dt><dd>{strategy.tools}</dd></div><div><dt>Rules</dt><dd>{strategy.rule}</dd></div></dl><button className="am-button" onClick={()=>navigate(strategy.chapter)}>Explore this architecture ↗</button></div>
  </section>;
}

export function MechanismDetails({mechanism,onSelect}:{mechanism:Mechanism;onSelect:(id:string)=>void}) {
  switch(mechanism.id){
    case 'observability':return <TraceInspector/>;
    case 'experiments':return <ExperimentMatrix/>;
    case 'luffy':return <IntradayInstrument/>;
    case 'guardrails':return <GuardrailInstrument onSelect={onSelect}/>;
    default:return null;
  }
}

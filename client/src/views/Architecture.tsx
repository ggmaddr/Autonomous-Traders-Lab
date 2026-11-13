import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArchitectureScene, type SceneHandle } from '../architecture/ArchitectureScene';
import { MechanismDetails, StrategyComparison } from '../architecture/MechanismDetails';
import { COMPONENTS, LAYERS, MECHANISMS, NODE, STATUS, getMechanism, type Layer, type Mechanism } from '../architecture/model';
import '../architecture/architecture.css';

function Miniature({mechanism}:{mechanism:Mechanism}) {
  const pts=mechanism.nodes.slice(0,10).map((_,i,a)=>mechanism.layout==='orbit'?[60+Math.cos(i/a.length*Math.PI*2)*38,37+Math.sin(i/a.length*Math.PI*2)*24]:[20+(i%5)*20,23+Math.floor(i/5)*29]);
  return <svg viewBox="0 0 120 76" aria-hidden="true"><path d="M4 60L60 74L116 60L60 46Z" fill="currentColor" opacity=".05"/>{pts.slice(1).map((p,i)=><path key={`e${i}`} d={`M${pts[i][0]} ${pts[i][1]} Q60 40 ${p[0]} ${p[1]}`} stroke="currentColor" opacity=".3" fill="none"/>)}{pts.map(([x,y],i)=><g key={i}><path d={`M${x-6} ${y}l6 -4 6 4v5l-6 4 -6 -4Z`} fill="var(--raised)" stroke="currentColor" strokeWidth=".8"/><path d={`M${x-6} ${y}l6 4 6 -4m-6 4v5`} fill="none" stroke="currentColor" strokeWidth=".6"/><circle cx={x} cy={y} r="1.4" fill="currentColor"/></g>)}</svg>;
}

function Inspector({mechanism,selected,onSelect,onFocus,navigate}:{mechanism:Mechanism;selected:string|null;onSelect:(id:string)=>void;onFocus:()=>void;navigate:(id:string)=>void}) {
  const node=selected?NODE[selected]:null;
  if(!node)return <aside className="am-inspector am-inspector-intro">
    <span className="am-eyebrow">Field notes / {mechanism.number}</span><h3>{mechanism.question}</h3><p>{mechanism.description}</p>
    <div className="am-inspector-rule"/><span className="am-eyebrow">Explore the instrument</span><ol><li><b>01</b><span>Select a component to inspect its contract.</span></li><li><b>02</b><span>Follow highlighted dependencies and named flows.</span></li><li><b>03</b><span>Play the walkthrough to see the mechanism unfold.</span></li></ol>
    <div className="am-status-key"><span><i/>Implemented code</span><span><i data-status="experimental"/>Experimental / limited</span><span><i data-status="planned"/>Planned</span></div>
    <p className="am-fine">Animation explains connections. It is not live telemetry or a claim that every configured service is online.</p>
  </aside>;
  const flows=mechanism.flows.filter(f=>f.from===node.id||f.to===node.id);
  const elsewhere=MECHANISMS.filter(m=>m.id!==mechanism.id&&m.id!=='overview'&&m.nodes.includes(node.id)).slice(0,3);
  return <aside className="am-inspector" aria-label="Component details">
    <div className="am-inspector-top"><span className="am-eyebrow">Component contract</span><button onClick={()=>onSelect('')} aria-label="Close component details">×</button></div>
    <span className="am-status" data-status={node.status}>{STATUS[node.status]}</span><h3>{node.name}</h3><p className="am-node-subtitle">{node.subtitle}</p><p>{node.purpose}</p>
    <button className="am-focus-button" onClick={onFocus}>⌖ Focus in 3D</button>
    <dl className="am-contract"><div><dt>Inputs</dt><dd>{node.inputs}</dd></div><div><dt>Outputs</dt><dd>{node.outputs}</dd></div></dl>
    {node.caveat&&<div className="am-component-caveat"><span>Engineering note</span><p>{node.caveat}</p></div>}
    <details open className="am-connections"><summary>Connected components <span>{flows.length}</span></summary>{flows.map((flow,i)=>{const out=flow.from===node.id;const other=out?flow.to:flow.from;return <button key={i} onClick={()=>onSelect(other)}><span>{out?'↗':'↙'} {NODE[other].name}</span><small>{out?'Sends':'Receives'} · {flow.label}</small></button>;})}</details>
    <details className="am-sources"><summary>Source references</summary>{node.sources.map(source=><code key={source}>{source}</code>)}</details>
    {!!elsewhere.length&&<div className="am-elsewhere"><span className="am-eyebrow">Explore in context</span>{elsewhere.map(m=><button key={m.id} onClick={()=>navigate(m.id)}>{m.short} ↗</button>)}</div>}
  </aside>;
}

export function Architecture() {
  const [params,setParams]=useSearchParams();const mechanism=getMechanism(params.get('mechanism'));
  const [selected,setSelected]=useState<string|null>(null);const [layer,setLayer]=useState<Layer|'all'>('all');
  const [moving,setMoving]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [expanded,setExpanded]=useState(false);const [cinema,setCinema]=useState(false);
  const [step,setStep]=useState(-1);const [playing,setPlaying]=useState(false);const [query,setQuery]=useState('');
  const scene=useRef<SceneHandle>(null);const exhibit=useRef<HTMLElement>(null);const cinemaButton=useRef<HTMLButtonElement>(null);
  const stepData=mechanism.steps[step];
  useEffect(()=>{setSelected(null);setLayer('all');setStep(-1);setPlaying(false);setQuery('');setExpanded(false);},[mechanism.id]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>{if(media.matches){setMoving(false);setPlaying(false);}};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    if(!playing||document.hidden)return;
    const timer=window.setTimeout(()=>{if(step>=mechanism.steps.length-1)setPlaying(false);else setStep(s=>s+1);},6500);
    const pause=()=>{if(document.hidden)setPlaying(false);};document.addEventListener('visibilitychange',pause);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',pause);};
  },[playing,step,mechanism]);
  useEffect(()=>{
    if(!cinema)return;
    const before=document.body.style.overflow;document.body.style.overflow='hidden';
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){setCinema(false);cinemaButton.current?.focus();}
      if(e.key==='Tab'){
        const list=Array.from(exhibit.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select,input,summary,a[href]')??[]).filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        const first=list[0],last=list.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };document.addEventListener('keydown',key);cinemaButton.current?.focus();
    return()=>{document.body.style.overflow=before;document.removeEventListener('keydown',key);};
  },[cinema]);
  function navigate(id:string){setParams(old=>{const p=new URLSearchParams(old);if(id==='overview')p.delete('mechanism');else p.set('mechanism',id);return p;});exhibit.current?.scrollIntoView({behavior:'instant',block:'start'});}
  function select(id:string){setSelected(id||null);setPlaying(false);setStep(-1);setLayer('all');}
  function changeStep(i:number){setSelected(null);setLayer('all');setStep(Math.max(0,Math.min(mechanism.steps.length-1,i)));}
  const filtered=mechanism.nodes.filter(id=>`${NODE[id].name} ${NODE[id].subtitle}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="am-page">
    <header className="am-page-header"><div><span className="am-eyebrow">Autonomous Traders Lab / Engineering atlas</span><h1>Architectural Mechanisms<span>.</span></h1><p>An explorable anatomy of the agents, evidence, and engineering behind the desk.</p></div><div className="am-header-seal"><span>5</span><small>AI traders</small><span>1</span><small>local model</small></div></header>
    <section ref={exhibit} className={`am-exhibit${cinema?' am-cinema':''}`} aria-label="Architecture explorer" role={cinema?'dialog':undefined} aria-modal={cinema||undefined}>
      <div className="am-exhibit-header"><div><span className="am-eyebrow">Mechanism {mechanism.number} / Interactive anatomy</span><h2>{mechanism.title}</h2></div><button ref={cinemaButton} className="am-icon-button" onClick={()=>setCinema(c=>!c)} aria-pressed={cinema} title={cinema?'Exit presentation (Escape)':'Presentation mode'}>{cinema?'↙ Exit presentation':'↗ Present'}</button></div>
      <div className="am-chapter-select"><label>Explore<select aria-label="Choose architectural mechanism" value={mechanism.id} onChange={e=>navigate(e.target.value)}>{MECHANISMS.map(m=><option key={m.id} value={m.id}>{m.number} — {m.short}</option>)}</select></label>{mechanism.id!=='overview'&&<button onClick={()=>navigate('overview')}>← Overall architecture</button>}<span className="am-map-label">Source-guided model · illustrative traffic</span></div>
      <div className="am-workbench">
        <div className="am-viewport">
          <div className="am-stage-meta"><span>FIG {mechanism.number} / {mechanism.layout.toUpperCase()}</span><span>{mechanism.nodes.length} components · {mechanism.flows.length} connections</span></div>
          <ArchitectureScene ref={scene} mechanism={mechanism} selected={selected} layer={layer} moving={moving} expanded={expanded} active={stepData?.nodes??[]} onSelect={select} onInteract={()=>{setPlaying(false);setMoving(false);}}/>
          <div className="am-layer-controls" aria-label="Highlight architectural layer"><button aria-pressed={layer==='all'} onClick={()=>setLayer('all')}>All layers</button>{(Object.keys(LAYERS) as Layer[]).filter(l=>mechanism.nodes.some(id=>NODE[id].layer===l)).map(l=><button key={l} aria-pressed={layer===l} onClick={()=>{setLayer(l);setSelected(null);setStep(-1);setPlaying(false);}} style={{'--layer-color':LAYERS[l].color} as CSSProperties}><i/>{LAYERS[l].label}</button>)}</div>
          <div className="am-stage-bottom"><span>Drag to orbit · scroll to zoom · shift-drag to pan</span><div className="am-flow-legend"><span><i/>Calls</span><span><i/>Data</span><span><i/>Writes</span><span><i/>Control</span></div></div>
        </div>
        <Inspector mechanism={mechanism} selected={selected} onSelect={select} onFocus={()=>selected&&scene.current?.focus(selected)} navigate={navigate}/>
      </div>
      <div className="am-toolbar" aria-label="3D controls">
        <div><button onClick={()=>{setSelected(null);setLayer('all');scene.current?.reset();}} title="Reset camera and selection">⌖ Reset view</button><button onClick={()=>{setMoving(false);scene.current?.zoom(1);}} aria-label="Zoom in">＋</button><button onClick={()=>{setMoving(false);scene.current?.zoom(-1);}} aria-label="Zoom out">−</button><button onClick={()=>{setMoving(false);scene.current?.rotate(-1);}} aria-label="Rotate left">↶</button><button onClick={()=>{setMoving(false);scene.current?.rotate(1);}} aria-label="Rotate right">↷</button></div>
        <div><button onClick={()=>setExpanded(v=>!v)} aria-pressed={expanded}>{expanded?'▤ Assemble layers':'▱ Separate layers'}</button><button className="am-motion-control" onClick={()=>setMoving(v=>!v)} aria-pressed={moving}>{moving?'Ⅱ Pause motion':'▷ Animate'}</button><span className="am-reduced-note">Reduced-motion mode</span></div>
      </div>
      <div className="am-walkthrough">
        <div className="am-walkthrough-top"><span className="am-eyebrow">Guided walkthrough</span><div><button onClick={()=>{setSelected(null);setLayer('all');if(step<0||step===mechanism.steps.length-1)setStep(0);setPlaying(p=>!p);}} aria-pressed={playing}>{playing?'Ⅱ Pause story':'▶ Play walkthrough'}</button>{step>=0&&<button onClick={()=>{setStep(-1);setPlaying(false);}}>Exit story</button>}</div></div>
        <div className="am-story-steps" aria-label="Walkthrough steps">{mechanism.steps.map((s,i)=><button key={s.title} aria-pressed={step===i} onClick={()=>{setPlaying(false);changeStep(i);}}><span>{String(i+1).padStart(2,'0')}</span><strong>{s.title}</strong></button>)}</div>
        <div className="am-story-caption" aria-live="polite"><span>{step>=0?`${step+1} / ${mechanism.steps.length}`:'READ THE SYSTEM'}</span><p>{stepData?.text??mechanism.insight}</p>{step>=0&&<div><button aria-label="Previous walkthrough step" disabled={step===0} onClick={()=>{setPlaying(false);changeStep(step-1);}}>←</button><button aria-label="Next walkthrough step" disabled={step===mechanism.steps.length-1} onClick={()=>{setPlaying(false);changeStep(step+1);}}>→</button></div>}</div>
      </div>
    </section>
    <div className="am-evidence-note"><span>READING THIS MAP</span><p>{mechanism.evidence} “Implemented” means a code path exists; it does not verify uptime or investment performance.</p></div>
    <details className="am-component-index"><summary>Component index <span>Keyboard-friendly alternative · {mechanism.nodes.length} components</span></summary><label className="am-field">Find a component<input type="search" placeholder="Search names or roles…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div>{filtered.map(id=><button key={id} aria-pressed={selected===id} onClick={()=>{select(id);exhibit.current?.scrollIntoView({behavior:'instant',block:'start'});}}><strong>{NODE[id].name}</strong><span>{NODE[id].subtitle}</span><small>{STATUS[NODE[id].status]}</small></button>)}{!filtered.length&&<p>No matching components.</p>}</div></details>
    <MechanismDetails key={mechanism.id} mechanism={mechanism} onSelect={select}/>
    <div className="am-related"><span className="am-eyebrow">Continue the thread</span>{mechanism.related.map(id=>{const m=getMechanism(id);return <button onClick={()=>navigate(id)} key={id}>{m.short} ↗</button>;})}{mechanism.destination&&<Link to={mechanism.destination.path}>{mechanism.destination.label} ↗</Link>}</div>
    <section className="am-catalog" aria-labelledby="catalog-heading"><div className="am-section-heading"><div><span className="am-eyebrow">The mechanism collection</span><h2>Zoom into the engineering.</h2></div><p>Different mechanisms. Different ways to see them.</p></div><div className="am-catalog-grid">{MECHANISMS.slice(1).map(m=><button key={m.id} className="am-mechanism-card" aria-pressed={mechanism.id===m.id} onClick={()=>navigate(m.id)}><div><span>{m.number}</span><Miniature mechanism={m}/><span>↗</span></div><h3>{m.short}</h3><p>{m.question}</p><small>{m.nodes.length} components · {m.layout==='orbit'?'Spatial constellation':m.layout==='tree'?'Execution tree':m.layout==='matrix'?'Experiment matrix':m.layout==='pipeline'?'Transformation circuit':'Layered infrastructure'}</small></button>)}</div></section>
    <StrategyComparison navigate={navigate}/>
    <footer className="am-footer"><span>Architecture, with a source for every claim.</span><p>{COMPONENTS.length} source-backed component contracts · <code>server/</code> + <code>client/</code> · Architecture audit: <code>cdde9d2</code>. This curated map should be reviewed when the implementation changes.</p></footer>
  </div>;
}

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS, NODE, neighbors, type Layer, type Mechanism, type Shape } from './model';

export interface SceneHandle { reset(): void; focus(id: string): void; zoom(direction: number): void; rotate(direction: number): void }
interface Props {
  mechanism: Mechanism; selected: string | null; layer: Layer | 'all'; moving: boolean;
  expanded: boolean; active: string[]; onSelect: (id: string) => void; onInteract: () => void;
}
type Part = { object: THREE.Group; materials: THREE.MeshStandardMaterial[]; halo: THREE.Mesh; position: THREE.Vector3 };
const systemPositions: Record<string, [number, number, number]> = {
  robin:[-10,2,-9],nami:[-5,2,-9],jinbe:[0,2,-9],law:[5,2,-9],luffy:[10,2,-9],
  floor:[-13,0,-3],research:[-6,0,-2],model:[0,0.6,-2],synth:[6,0,-2],fast:[13,0,-3],
  quant:[-10,0,4],web:[-5,0,4],graph:[0,0,4],daydesk:[5,0,4],accounts:[10,0,4],
  alpaca:[-13,0,10],traces:[-7,0,10],ledger:[-1,0,10],api:[5,0,10],client:[12,0,10],gateway:[14,0,4],
  fundamentals:[-8,0,3],market:[-15,0,2],
};
export function positionsFor(mechanism: Mechanism, expanded: boolean): Map<string, THREE.Vector3> {
  const count = mechanism.nodes.length;
  return new Map(mechanism.nodes.map((id,i)=> {
    let p: [number,number,number];
    if(mechanism.layout==='system') p=systemPositions[id]??[(i%4-1.5)*7,0,(Math.floor(i/4)-1)*7];
    else if(mechanism.layout==='orbit') {
      const hub=mechanism.id==='memory'?'graph':'model';
      const rest=mechanism.nodes.filter(n=>n!==hub); const j=rest.indexOf(id);
      const a=j/rest.length*Math.PI*2-Math.PI/2;
      p=id===hub?[0,1.4,0]:[Math.cos(a)*12, (j%2)*1.2, Math.sin(a)*10];
    } else if(mechanism.layout==='tree') {
      p=i===0?[0,3,-10]:i<4?[(i-2)*9,1,-3]:[(i-4-(count-5)/2)*5,0,6];
    } else if(mechanism.layout==='matrix') {
      const matrix: [number,number,number][]=[[-10,0,-6],[0,2,-7],[0,0,0],[10,1,-6],[-7,0,7],[3,0,9],[10,0,3]];
      p=matrix[i];
    } else {
      const cols=Math.ceil(count/2); const row=Math.floor(i/cols);const col=i%cols;
      p=[(col-(cols-1)/2)*6.5, row===0?1.3:0, (row-.5)*11];
    }
    const layerLift=expanded?({agents:3.5,compute:2.5,tools:1.5,data:.8,interface:0}[NODE[id].layer]):0;
    return [id,new THREE.Vector3(p[0],p[1]+layerLift,p[2])];
  }));
}

/** A shared instrument vocabulary. Components are machined modules, not floating dots.
 * Each module: socket, plinth, feet, four fasteners, signal ring, and a role-specific core.
 * All animation is time-based; no React renders occur inside the drawing loop.
 */
export const ArchitectureScene = forwardRef<SceneHandle, Props>(function ArchitectureScene(props, forwardedRef) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current=props;
  const actions=useRef<SceneHandle>({reset(){},focus(){},zoom(){},rotate(){}});
  const [failed,setFailed]=useState(false);
  useImperativeHandle(forwardedRef,()=>({reset:()=>actions.current.reset(),focus:id=>actions.current.focus(id),zoom:d=>actions.current.zoom(d),rotate:d=>actions.current.rotate(d)}),[]);
  useEffect(()=> {
    const host=mount.current;
    if(!host)return;
    const root: HTMLDivElement=host;
    let renderer: THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}
    catch {setFailed(true);return;}
    setFailed(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
    renderer.setClearColor(0x0c131b,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.4;
    renderer.domElement.setAttribute('aria-hidden','true');
    root.appendChild(renderer.domElement);
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(38,1,.1,200);
    const home=new THREE.Vector3(9,30,39);
    const controls=new OrbitControls(camera,renderer.domElement);
    camera.position.copy(home); controls.target.set(0,0,0);
    controls.enableDamping=true;controls.dampingFactor=.09;
    controls.minDistance=12;controls.maxDistance=88;
    controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.15;
    controls.autoRotateSpeed=.18;
    controls.enablePan=true;
    const ambient=new THREE.HemisphereLight(0xd6e6ff,0x181c24,2.6);scene.add(ambient);
    const key=new THREE.DirectionalLight(0xffefd6,3.4);key.position.set(-12,26,8);scene.add(key);
    const fill=new THREE.DirectionalLight(0x6b9dc9,2);fill.position.set(18,10,-15);scene.add(fill);
    const objects=new THREE.Group();scene.add(objects);
    const geometries: THREE.BufferGeometry[]=[];
    const allMaterials: THREE.Material[]=[];
    const geometry=<T extends THREE.BufferGeometry>(g:T):T=>{geometries.push(g);return g;};
    const box=geometry(new THREE.BoxGeometry(1,1,1));
    const cylinder=geometry(new THREE.CylinderGeometry(1,1,1,24));
    const hex=geometry(new THREE.CylinderGeometry(1,1,1,6));
    const sphere=geometry(new THREE.SphereGeometry(1,10,8));
    const ring=geometry(new THREE.TorusGeometry(1,.025,6,48));
    const metal=(color:string,emissive=0)=> {
      const m=new THREE.MeshStandardMaterial({color,metalness:.32,roughness:.42,emissive:new THREE.Color(color),emissiveIntensity:emissive,transparent:true});
      allMaterials.push(m);return m;
    };
    const neutral=metal('#607587'), edgeMetal=metal('#a8bac7'), dark=metal('#263747');
    const sharedNeutral=[neutral,edgeMetal,dark];
    function mesh(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number) {
      const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);parent.add(o);return o;
    }
    // The physical support changes with the mechanism, not just its node positions.
    const bench=metal('#162632');
    let grid: THREE.GridHelper | null=null;
    if(props.mechanism.layout==='orbit') {
      mesh(objects,cylinder,bench,0,-2.35,0,14.5,.45,13);
      mesh(objects,cylinder,dark,0,-2.08,0,14,.12,12.5);
      for(const r of [4,8,12.5]) {
        const orbit=mesh(objects,ring,edgeMetal,0,-1.99,0,r,r,r*.88);orbit.rotation.x=Math.PI/2;
      }
      for(let i=0;i<48;i++) {
        const a=i/48*Math.PI*2;
        const tick=mesh(objects,box,edgeMetal,Math.cos(a)*13.8,-1.96,Math.sin(a)*12.2,.045,.035,i%4===0?.4:.18);
        tick.rotation.y=-a+Math.PI/2;
      }
    } else if(props.mechanism.layout==='pipeline'||props.mechanism.layout==='tree') {
      const rows=props.mechanism.layout==='tree'?[-10,-3,6]:[-5.5,5.5];
      rows.forEach((z,row)=> {
        const width=props.mechanism.layout==='tree'?(row===0?7:row===1?23:32):32;
        mesh(objects,box,bench,0,-2.2,z,width,.5,5);
        for(const dz of [-2.35,2.35]) {
          mesh(objects,box,edgeMetal,0,-1.91,z+dz,width,.08,.08);
          for(let i=0;i<Math.floor(width);i++)mesh(objects,box,edgeMetal,i-width/2+.5,-1.87,z+dz,.035,.035,.25);
        }
        for(const x of [-width/2+.6,width/2-.6]) {
          mesh(objects,cylinder,edgeMetal,x,-1.88,z,.12,.1,.12);
          mesh(objects,box,dark,x,-2.8,z,.8,.8,3.5);
        }
      });
    } else {
      mesh(objects,box,bench,0,-2.15,0,34,.35,25);
      mesh(objects,box,neutral,0,-2.37,0,34.4,.14,25.4);
      for(const x of [-16.5,16.5])for(const z of [-12,12]) {
        mesh(objects,cylinder,edgeMetal,x,-1.92,z,.17,.14,.17);
        mesh(objects,cylinder,dark,x,-2.65,z,.65,.5,.65);
      }
      grid=new THREE.GridHelper(32,32,0x34485a,0x1a2c3b);grid.scale.z=.76;grid.position.y=-1.95;objects.add(grid);
    }
    const parts=new Map<string,Part>(); const labels=new Map<string,HTMLButtonElement>();
    const leaderSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    leaderSvg.classList.add('am-label-leaders');leaderSvg.setAttribute('aria-hidden','true');root.appendChild(leaderSvg);
    const leaders=new Map<string,SVGLineElement>();
    const labelSizes=new Map<string,[number,number]>();
    const labelPositions=new Map<string,{x:number;y:number}>();
    const initialPositions=positionsFor(props.mechanism,props.expanded);
    const clickables: THREE.Object3D[]=[];
    function core(group:THREE.Group,shape:Shape,signal:THREE.MeshStandardMaterial) {
      if(shape==='agent') {
        mesh(group,hex,neutral,0,.36,0,1,.62,1);
        mesh(group,hex,signal,0,.7,0,.78,.08,.78);
        mesh(group,hex,dark,0,.84,0,.52,.23,.52);
        mesh(group,cylinder,signal,0,1.06,0,.13,.17,.13);
        for(let j=0;j<6;j++){const a=j*Math.PI/3;mesh(group,box,edgeMetal,Math.cos(a)*.72,.25,Math.sin(a)*.72,.12,.42,.12);}
      } else if(shape==='store') {
        for(let j=0;j<3;j++) {
          mesh(group,cylinder,neutral,0,.22+j*.35,0,.85,.28,.85);
          mesh(group,cylinder,signal,0,.38+j*.35,0,.87,.045,.87);
        }
        mesh(group,cylinder,edgeMetal,0,1.16,0,.74,.07,.74);
      } else if(shape==='chip') {
        mesh(group,box,neutral,0,.35,0,1.6,.45,1.6);
        mesh(group,box,signal,0,.61,0,1.05,.1,1.05);
        mesh(group,box,dark,0,.71,0,.72,.13,.72);
        for(let i=0;i<5;i++)for(const side of [-1,1]) {
          mesh(group,box,edgeMetal,side*.97,.24,(i-2)*.28,.37,.1,.1);
          mesh(group,box,edgeMetal,(i-2)*.28,.24,side*.97,.1,.1,.37);
        }
      } else if(shape==='gate') {
        for(const side of [-1,1])mesh(group,box,neutral,side*.7,.55,0,.28,1.1,.8);
        mesh(group,box,edgeMetal,0,1.1,0,1.7,.22,.8);
        mesh(group,box,signal,0,.6,0,1,.72,.12);
        for(let i=0;i<3;i++)mesh(group,box,dark,(i-1)*.28,.6,.08,.1,.58,.03);
      } else if(shape==='clock') {
        mesh(group,cylinder,neutral,0,.25,0,.9,.5,.9);
        mesh(group,cylinder,dark,0,.52,0,.78,.05,.78);
        for(let i=0;i<12;i++) {
          const a=i*Math.PI/6;
          mesh(group,cylinder,edgeMetal,Math.cos(a)*.66,.57,Math.sin(a)*.66,.035,.04,.035);
        }
        mesh(group,box,signal,.18,.61,0,.5,.07,.09);mesh(group,box,signal,0,.61,-.2,.09,.07,.5);
      } else {
        mesh(group,box,neutral,0,.55,0,1.55,1.1,1.05);
        for(let i=0;i<3;i++) {
          mesh(group,box,dark,0,.25+i*.3,.55,1.3,.22,.04);
          mesh(group,box,signal,-.48,.25+i*.3,.59,.11,.08,.035);
          mesh(group,box,edgeMetal,.18,.25+i*.3,.59,.57,.04,.035);
        }
        mesh(group,box,edgeMetal,0,1.12,0,1.6,.06,1.1);
      }
    }
    for(const id of props.mechanism.nodes) {
      const n=NODE[id];const group=new THREE.Group();group.userData.node=id;
      const signal=metal(LAYERS[n.layer].color,.38);const chassis=metal('#425b6c');
      group.position.copy(initialPositions.get(id)!);objects.add(group);
      const rest=positionsFor(props.mechanism,false).get(id)!;
      const stand=mesh(objects,cylinder,neutral,rest.x,(rest.y-.8-1.95)/2,rest.z,.43,rest.y+1.15,.43);
      stand.userData.node=id;clickables.push(stand);
      mesh(objects,cylinder,edgeMetal,rest.x,-1.88,rest.z,.62,.12,.62);
      mesh(group,hex,chassis,0,-.16,0,1.5,.23,1.5);
      mesh(group,hex,dark,0,-.02,0,1.36,.1,1.36);
      for(const x of [-.85,.85])for(const z of [-.85,.85])mesh(group,cylinder,edgeMetal,x,.05,z,.07,.08,.07);
      core(group,n.shape,signal);
      // A copper contact pad and support collar connect the module to its socket.
      mesh(group,cylinder,chassis,0,-.55,0,.7,.55,.7);
      mesh(group,cylinder,signal,0,-.27,0,.74,.045,.74);
      const halo=mesh(group,ring,signal,0,-.01,0,1.57,1.57,1.57);halo.rotation.x=Math.PI/2;
      if(n.status==='planned') { signal.wireframe=true; chassis.wireframe=true; }
      // Bake static module parts by material: hundreds of machined details, few draw calls.
      const moduleMaterials=[signal,chassis];
      const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
      for(const child of [...group.children]) {
        if(!(child instanceof THREE.Mesh)||child===halo)continue;
        child.updateMatrix();const baked=child.geometry.clone().applyMatrix4(child.matrix);
        const material=child.material as THREE.Material;
        const list=batches.get(material)??[];list.push(baked);batches.set(material,list);group.remove(child);
      }
      for(const [material,pieces] of batches) {
        const merged=mergeGeometries(pieces,false);
        let finish=material;
        if(sharedNeutral.includes(material as THREE.MeshStandardMaterial)) {
          const local=(material as THREE.MeshStandardMaterial).clone();allMaterials.push(local);moduleMaterials.push(local);finish=local;
        }
        if(merged)group.add(new THREE.Mesh(geometry(merged),finish));
        pieces.forEach(g=>g.dispose());
      }
      group.traverse(o=>{if(o instanceof THREE.Mesh){o.userData.node=id;clickables.push(o);}});
      parts.set(id,{object:group,materials:moduleMaterials,halo,position:group.position.clone()});
      const button=document.createElement('button');
      button.type='button';button.className='am-node-label';button.dataset.node=id;
      button.style.setProperty('--node-color',LAYERS[n.layer].color);button.dataset.status=n.status;
      const title=document.createElement('strong');title.textContent=n.name;
      const sub=document.createElement('span');sub.textContent=n.status==='planned'?'Planned':n.status==='limited'?'Known limitation':n.status==='experimental'?'Experimental comparison':n.subtitle;
      button.append(title,sub);button.setAttribute('aria-label',`${n.name}: ${n.subtitle}. Inspect component`);
      button.onclick=()=>{latest.current.onInteract();latest.current.onSelect(id);};
      root.appendChild(button);labels.set(id,button);
      const leader=document.createElementNS('http://www.w3.org/2000/svg','line');leaderSvg.appendChild(leader);leaders.set(id,leader);
    }
    const flowObjects=props.mechanism.flows.map((e,i)=> {
      const color={call:'#7d9baf',data:'#77b6ed',write:'#67d9c5',control:'#eac078'}[e.kind];
      const material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.35});allMaterials.push(material);
      const g=geometry(new THREE.BufferGeometry().setFromPoints(Array.from({length:41},()=>new THREE.Vector3())));
      const line=new THREE.Line(g,material);line.frustumCulled=false;objects.add(line);
      const beadMaterial=new THREE.MeshBasicMaterial({color});allMaterials.push(beadMaterial);
      const bead=mesh(objects,sphere,beadMaterial,0,0,0,.085,.085,.085);
      const arrow=mesh(objects,geometry(new THREE.ConeGeometry(.13,.36,6)),beadMaterial,0,0,0,1,1,1);
      return {e,line,bead,arrow,curve:new THREE.CubicBezierCurve3(),offset:i*.173,material,beadMaterial};
    });
    let flight:{position:THREE.Vector3;target:THREE.Vector3}|null=null;
    let visible=true,frame=0,previous=0,phase=0,needsDraw=true;
    let lastLayout=props.expanded;let targets=initialPositions;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();
    let down:[number,number]=[0,0];
    const onDown=(event:PointerEvent)=>{down=[event.clientX,event.clientY];};
    const onUp=(event:PointerEvent)=> {
      if(Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
      const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(clickables,false)[0];
      if(hit){latest.current.onSelect(hit.object.userData.node);latest.current.onInteract();}
    };
    const interrupt=()=>{flight=null;latest.current.onInteract();needsDraw=true;};
    controls.addEventListener('start',interrupt);
    controls.addEventListener('change',()=>{needsDraw=true;});
    renderer.domElement.addEventListener('pointerdown',onDown);
    renderer.domElement.addEventListener('pointerup',onUp);
    const contextLost=(event:Event)=>{event.preventDefault();setFailed(true);};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    const resize=new ResizeObserver(()=>{
      const {width,height}=root.getBoundingClientRect();
      if(width<1||height<1)return;
      camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);labelSizes.clear();needsDraw=true;
      // Keep a readable full-system framing at portrait aspect ratios.
      if(!latest.current.selected)camera.position.copy(home).multiplyScalar(width<600?1.35:1);
    });resize.observe(root);
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;needsDraw=true;});observer.observe(root);
    const motionChange=()=>{needsDraw=true;};reduced.addEventListener('change',motionChange);
    function travel(position:THREE.Vector3,target:THREE.Vector3) {
      if(reduced.matches){camera.position.copy(position);controls.target.copy(target);controls.update();needsDraw=true;}
      else flight={position,target};
    }
    actions.current={
      reset(){travel(home.clone().multiplyScalar(root.clientWidth<600?1.35:1),new THREE.Vector3());},
      focus(id){const p=parts.get(id)?.object.position;if(p)travel(p.clone().add(new THREE.Vector3(5,10,15)),p.clone());},
      zoom(d){const offset=camera.position.clone().sub(controls.target).multiplyScalar(d>0?.8:1.25);offset.clampLength(controls.minDistance,controls.maxDistance);travel(controls.target.clone().add(offset),controls.target.clone());},
      rotate(d){const offset=camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0,1,0),d*.25);travel(controls.target.clone().add(offset),controls.target.clone());},
    };
    const projected=new THREE.Vector3(), point=new THREE.Vector3(), tangent=new THREE.Vector3();
    const up=new THREE.Vector3(0,1,0);
    let lastSignature='';
    let settling=true;
    let measuredAt=0;
    let pathsReady=false;
    function draw(time:number) {
      frame=requestAnimationFrame(draw);
      const dt=Math.min((time-previous)/1000,.05);previous=time;
      if(!visible||document.hidden)return;
      const p=latest.current;const anim=p.moving&&!reduced.matches;
      const signature=`${p.selected}|${p.layer}|${p.expanded}|${p.active.join()}|${p.moving}`;
      if(signature!==lastSignature){needsDraw=true;lastSignature=signature;}
      if(!anim&&!flight&&!needsDraw&&!settling){controls.update(dt);return;}
      controls.autoRotate=anim&&!p.selected&&p.active.length===0;
      if(anim)phase+=dt;
      if(p.expanded!==lastLayout){lastLayout=p.expanded;targets=positionsFor(p.mechanism,p.expanded);}
      const selectedSet=p.selected?neighbors(p.mechanism,p.selected):null;
      const activeSet=new Set(p.active);
      let transitioning=false;
      for(const [id,part] of parts) {
        const target=targets.get(id)!;
        if(part.object.position.distanceTo(target)>.002){part.object.position.lerp(target,reduced.matches?1:1-Math.exp(-5*dt));transitioning=true;}
        const layerOn=p.layer==='all'||NODE[id].layer===p.layer;
        const chosen=p.selected===id;
        const bright=layerOn&&(!selectedSet||selectedSet.has(id))&&(!activeSet.size||activeSet.has(id));
        part.materials.forEach((m,j)=>{m.opacity=bright?1:.2;if(j===0)m.emissiveIntensity=chosen?.9:activeSet.has(id)?.7:.36;});
        // Neutral structural parts remain deliberately subdued; signal carries state.
        part.halo.scale.setScalar(chosen?1.72:1.57);
        const label=labels.get(id)!;
        label.dataset.selected=String(chosen);label.dataset.dim=String(!bright);
        label.setAttribute('aria-pressed',String(chosen));

      }
      for(const item of flowObjects) {
        const a=parts.get(item.e.from)!.object.position,b=parts.get(item.e.to)!.object.position;
        if(transitioning||!pathsReady){
        item.curve.v0.copy(a).add(new THREE.Vector3(0,.12,0));item.curve.v3.copy(b).add(new THREE.Vector3(0,.12,0));
        const lift=Math.min(a.distanceTo(b)*.12,2.5);
        item.curve.v1.copy(a).lerp(b,.3).add(new THREE.Vector3(0,lift,0));
        item.curve.v2.copy(a).lerp(b,.7).add(new THREE.Vector3(0,lift,0));
        }
        const connected=!selectedSet||item.e.from===p.selected||item.e.to===p.selected;
        const layerOn=p.layer==='all'||NODE[item.e.from].layer===p.layer||NODE[item.e.to].layer===p.layer;
        const tourOn=!activeSet.size||(activeSet.has(item.e.from)&&activeSet.has(item.e.to));
        const strong=connected&&layerOn&&tourOn;
        item.material.opacity=strong?(p.selected||activeSet.size?.85:.34):.045;
        if(transitioning||!pathsReady){const pos=item.line.geometry.attributes.position;
        for(let i=0;i<=40;i++){item.curve.getPoint(i/40,point);pos.setXYZ(i,point.x,point.y,point.z);}pos.needsUpdate=true;}
        item.bead.visible=strong&&anim;
        item.curve.getPoint((phase*.18+item.offset)%1,item.bead.position);
        item.curve.getPoint(.72,item.arrow.position);item.curve.getTangent(.72,tangent).normalize();item.arrow.quaternion.setFromUnitVectors(up,tangent);
        item.arrow.visible=strong;item.beadMaterial.opacity=strong?1:.1;
      }
      pathsReady=true;
      if(flight){camera.position.lerp(flight.position,1-Math.exp(-5*dt));controls.target.lerp(flight.target,1-Math.exp(-5*dt));if(camera.position.distanceTo(flight.position)<.02)flight=null;needsDraw=true;}
      settling=transitioning;
      controls.update(dt);
      // Keep HTML labels readable even on phones. Displaced labels retain a leader
      // to their true 3D anchor; no dependency or position is invented by this layout.
      const placed:{left:number;right:number;top:number;bottom:number}[]=[];
      const labelOrder=[...parts].sort(([a],[b])=>Number(b===p.selected)-Number(a===p.selected));
      for(const [id,part] of labelOrder) {
        const label=labels.get(id)!,leader=leaders.get(id)!;
        projected.copy(part.object.position).add(new THREE.Vector3(0,1.8,0)).project(camera);
        const ax=(projected.x*.5+.5)*root.clientWidth,ay=(-projected.y*.5+.5)*root.clientHeight;
        const inView=projected.z<=1&&projected.z>=-1&&ax>=-40&&ax<=root.clientWidth+40&&ay>=-30&&ay<=root.clientHeight+30;
        label.style.visibility=inView?'visible':'hidden';leader.style.display=inView?'':'none';
        if(!inView)continue;
        if(!labelSizes.has(id))labelSizes.set(id,[label.offsetWidth,label.offsetHeight]);
        const [w,h]=labelSizes.get(id)!;
        const clampX=(x:number)=>Math.max(w/2+5,Math.min(root.clientWidth-w/2-5,x));
        const clampY=(y:number)=>Math.max(38+h,Math.min(root.clientHeight-12,y));
        const candidates:{x:number;y:number;cost:number}[]=[];
        for(let dy=-5;dy<=5;dy++)for(let dx=-2;dx<=2;dx++) {
          const x=clampX(ax+dx*(w+7)),y=clampY(ay+dy*(h+6));
          const overlaps=placed.reduce((total,r)=>total+Math.max(0,Math.min(x+w/2+3,r.right)-Math.max(x-w/2-3,r.left))*Math.max(0,Math.min(y+3,r.bottom)-Math.max(y-h-3,r.top)),0);
          candidates.push({x,y,cost:overlaps*100+Math.hypot(x-ax,(y-ay)*.8)});
        }
        candidates.sort((a,b)=>a.cost-b.cost);let {x,y}=candidates[0];
        placed.push({left:x-w/2-2,right:x+w/2+2,top:y-h-2,bottom:y+2});
        const previousLabel=labelPositions.get(id);
        if(previousLabel&&!reduced.matches){if(Math.hypot(previousLabel.x-x,previousLabel.y-y)>.25)settling=true;const follow=1-Math.exp(-18*dt);x=previousLabel.x+(x-previousLabel.x)*follow;y=previousLabel.y+(y-previousLabel.y)*follow;}
        labelPositions.set(id,{x,y});
        label.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;
        label.style.zIndex=String(Math.round((1-projected.z)*10000)+(id===p.selected?1000:0));
        leader.setAttribute('x1',String(ax));leader.setAttribute('y1',String(ay+6));leader.setAttribute('x2',String(x));leader.setAttribute('y2',String(y));
        leader.style.opacity=Math.hypot(x-ax,y-ay)>8?'0.55':'0';
      }
      if(anim||transitioning||needsDraw||flight){renderer.render(scene,camera);needsDraw=false;}
      if(time-measuredAt>1000){root.dataset.drawCalls=String(renderer.info.render.calls);measuredAt=time;}
    }
    frame=requestAnimationFrame(draw);
    return ()=> {
      cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();reduced.removeEventListener('change',motionChange);
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',onUp);
      controls.dispose();geometries.forEach(g=>g.dispose());allMaterials.forEach(m=>m.dispose());
      if(grid){if(grid.material instanceof THREE.Material)grid.material.dispose();grid.geometry.dispose();}
      sharedNeutral.length=0;renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();labels.forEach(label=>label.remove());leaderSvg.remove();
    };
  },[props.mechanism]);
  return <div className="am-scene-wrap">
    <div ref={mount} className="am-scene" data-renderer={failed?'fallback':'webgl'} aria-label={`Interactive 3D ${props.mechanism.short}. Use component buttons or the component index to inspect. Drag to orbit; scroll to zoom.`} />
    {failed&&<div className="am-fallback"><strong>Component explorer</strong><p>3D is unavailable on this device. Every component, connection and walkthrough remains accessible below.</p><div>{props.mechanism.nodes.map(id=><button key={id} onClick={()=>props.onSelect(id)} aria-pressed={props.selected===id}>{NODE[id].name}</button>)}</div></div>}
  </div>;
});

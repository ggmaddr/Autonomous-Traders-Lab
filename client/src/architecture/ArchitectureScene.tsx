import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS, NODE, neighbors, type Layer, type Mechanism, type Shape } from './model';

export interface SceneHandle { reset(): void; focus(id: string): void; zoom(direction: number): void; rotate(direction: number): void }
interface Props {
  mechanism: Mechanism; selected: string | null; layer: Layer | 'all'; moving: boolean;
  expanded: boolean; active: string[]; onSelect: (id: string) => void; onInteract: () => void;
}
type Part = { object: THREE.Group; materials: THREE.MeshStandardMaterial[]; halo: THREE.Mesh; position: THREE.Vector3; labelHeight: number };
const systemPositions: Record<string, [number, number, number]> = {
  robin:[-10,2,-9],nami:[-5,2,-9],jinbe:[0,2,-9],law:[5,2,-9],luffy:[10,2,-9],
  floor:[-13,0,-3],research:[-6,0,-2],model:[0,0.6,-2],synth:[6,0,-2],fast:[13,0,-3],
  quant:[-10,0,4],web:[-5,0,4],graph:[0,0,4],daydesk:[5,0,4],accounts:[10,0,4],
  alpaca:[-13,0,10],traces:[-7,0,10],ledger:[-1,0,10],api:[5,0,10],client:[12,0,10],gateway:[14,0,4],
  fundamentals:[-8,0,3],market:[-15,0,2],
};
// Identity accents are independent of the layer legend (labels retain layer colors).
const identityColors: Record<string,string> = {
  robin:'#b897f5',nami:'#ffb85c',jinbe:'#53c7ed',law:'#72dbc2',luffy:'#ff746c',
  research:'#75d8ef',synth:'#f2bb70',graph:'#73d7c2',api:'#4b9bd3',client:'#61dafb',quant:'#a998f5',alpaca:'#53d5ce',
  review:'#efb55c',lesson:'#cb9bfa',recall:'#6fc6ff',learning:'#ed8db7',
  web:'#6ebdf5',accounts:'#b28bf2',fast:'#83d99a',daydesk:'#f3aa63',market:'#62d6c5',
};
const memoryPositions: Record<string,[number,number,number]> = {
  web:[-12,0,-7],research:[-7,1,-3],robin:[-9,.6,6],graph:[0,1.5,0],
  ledger:[1,0,-9],review:[9,.8,-7],lesson:[9,1.2,0],recall:[3,.3,7],learning:[12,0,8],
};
export function positionsFor(mechanism: Mechanism, expanded: boolean): Map<string, THREE.Vector3> {
  const count = mechanism.nodes.length;
  return new Map(mechanism.nodes.map((id,i)=> {
    let p: [number,number,number];
    if(mechanism.layout==='system') p=systemPositions[id]??[(i%4-1.5)*7,0,(Math.floor(i/4)-1)*7];
    else if(mechanism.layout==='map') p=memoryPositions[id]??[0,0,0];
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
    const roundedBox=geometry(new RoundedBoxGeometry(1,1,1,2,.1));
    if(!roundedBox.index)roundedBox.setIndex(Array.from({length:roundedBox.attributes.position.count},(_,i)=>i));
    const cylinder=geometry(new THREE.CylinderGeometry(1,1,1,24));
    const hex=geometry(new THREE.CylinderGeometry(1,1,1,6));
    const sphere=geometry(new THREE.SphereGeometry(1,10,8));
    const headSphere=geometry(new THREE.SphereGeometry(1,24,16));
    const spectacles=geometry(new THREE.TorusGeometry(.27,.035,6,24));
    const smile=geometry(new THREE.TorusGeometry(.2,.025,6,16,Math.PI));
    // Python silhouette adapted from Simple Icons (CC0), with an actual eye cutout.
    // One shallow extrusion is reused, rotated 180 degrees for the second snake.
    const snake=new THREE.Shape();snake.moveTo(11.858,0);
    const curve=(a:number,b:number,c:number,d:number,e:number,f:number)=>{
      const {x,y}=snake.currentPoint;snake.bezierCurveTo(x+a,y+b,x+c,y+d,x+e,y+f);
    };
    curve(-.978,.005,-1.913,.088,-2.736,.234);
    snake.bezierCurveTo(6.7,.662,6.26,1.558,6.26,3.21);
    snake.lineTo(6.26,5.392);snake.lineTo(11.985,5.392);snake.lineTo(11.985,6.119);snake.lineTo(4.111,6.119);
    curve(-1.664,0,-3.121,1,-3.577,2.903);curve(-.526,2.181,-.549,3.542,0,5.82);
    curve(.407,1.694,1.379,2.902,3.043,2.902);
    snake.lineTo(5.546,17.744);snake.lineTo(5.546,15.128);
    curve(0,-1.89,1.635,-3.557,3.576,-3.557);snake.lineTo(14.842,11.571);
    curve(1.591,0,2.862,-1.31,2.862,-2.91);snake.lineTo(17.704,3.211);
    curve(0,-1.553,-1.309,-2.718,-2.863,-2.977);
    snake.bezierCurveTo(13.85,.06,12.85,0,11.858,0);snake.closePath();
    const eye=new THREE.Path();eye.absarc(8.762,2.85,1.08,0,Math.PI*2,true);snake.holes.push(eye);
    const pythonSnake=geometry(new THREE.ExtrudeGeometry(snake,{depth:1.8,bevelEnabled:true,bevelThickness:.16,bevelSize:.16,bevelSegments:1,curveSegments:8,steps:1}));
    // ExtrudeGeometry is non-indexed; match the indexed primitives before batching.
    pythonSnake.setIndex(Array.from({length:pythonSnake.attributes.position.count},(_,i)=>i));
    pythonSnake.translate(-12,-12,-.9).rotateX(Math.PI).scale(.095,.095,.095);
    const ring=geometry(new THREE.TorusGeometry(1,.025,6,48));
    const lensRim=geometry(new THREE.TorusGeometry(1,.1,6,32));
    const metal=(color:string,emissive=0)=> {
      const m=new THREE.MeshStandardMaterial({color,metalness:.32,roughness:.42,emissive:new THREE.Color(color),emissiveIntensity:emissive,transparent:true});
      allMaterials.push(m);return m;
    };
    const neutral=metal('#607587'), edgeMetal=metal('#a8bac7'), dark=metal('#263747');
    const porcelain=metal('#d9e6ef'),visor=metal('#071622');
    visor.roughness=.24;
    const graphColors=['#67dac5','#ac92f5','#ffbc64','#6cbef6'].map(c=>metal(c,.3));
    const pythonGold=metal('#ffd343',.2);
    const marketRed=metal('#ff797b',.3);
    const mathInks=['#6535bb','#087d94','#cc365f'].map(c=>metal(c));
    const ocean=metal('#146ab4'),walletLeather=metal('#7b42b0');walletLeather.roughness=.7;
    const sharedNeutral=[neutral,edgeMetal,dark,porcelain,visor,pythonGold,marketRed,ocean,walletLeather,...graphColors,...mathInks];
    function mesh(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number) {
      const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);parent.add(o);return o;
    }
    // The physical support changes with the mechanism, not just its node positions.
    const bench=metal('#162632');
    let grid: THREE.GridHelper | null=null;
    if(props.mechanism.layout==='map') {
      // An atlas surface, rather than the orchestration turntable. Colored regions
      // separate evidence, review and recall; only model.flows supplies connections.
      mesh(objects,box,bench,0,-2.25,0,33,.35,25);
      for(const [x,z,w,d,color] of [
        [-9,-1,10,20,0],[6,-5,14,13,2],[7,7,15,7,1],
      ] as const) {
        mesh(objects,box,dark,x,-2.02,z,w,.08,d);
        mesh(objects,box,graphColors[color],x-w/2+.12,-1.96,z,.08,.04,d-.4);
      }
      grid=new THREE.GridHelper(32,16,0x34485a,0x233642);grid.scale.z=.75;grid.position.y=-1.95;objects.add(grid);
    } else if(props.mechanism.layout==='orbit') {
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
    const initialPositions=positionsFor(props.mechanism,props.expanded);
    const clickables: THREE.Object3D[]=[];
    function core(group:THREE.Group,shape:Shape,signal:THREE.MeshStandardMaterial,id:string) {
      if(shape==='agent'||shape==='researcher') {
        mesh(group,cylinder,dark,0,.19,0,.42,.3,.42);
        mesh(group,cylinder,signal,0,.35,0,.5,.1,.5);
        const head=new THREE.Group();head.position.y=1.18;head.rotation.x=-.3;group.add(head);
        const broad=id==='jinbe'?1.12:1;
        mesh(head,headSphere,porcelain,0,0,0,broad,.87,.78);
        mesh(head,headSphere,visor,0,-.02,.62,.84,.64,.28);
        for(const side of [-1,1]) {
          mesh(head,headSphere,signal,side*.31,.08,.887,.115,.21,.045);
          const ear=mesh(head,cylinder,signal,side*broad,0,0,.28,.13,.28);ear.rotation.z=Math.PI/2;
          const inset=mesh(head,cylinder,dark,side*(broad+.075),0,0,.18,.025,.18);inset.rotation.z=Math.PI/2;
        }
        const mouth=mesh(head,smile,signal,0,-.23,.89,1,.65,1);mouth.rotation.z=Math.PI;
        if(shape==='researcher') {
          for(const side of [-1,1]) {
            mesh(head,spectacles,edgeMetal,side*.31,.08,.98,1,1,1);
            mesh(head,box,edgeMetal,side*.65,.08,.74,.075,.065,.48);
          }
          mesh(head,box,edgeMetal,0,.08,.98,.14,.065,.055);
          mesh(head,cylinder,edgeMetal,0,1.01,0,.04,.32,.04);
          mesh(head,sphere,signal,0,1.2,0,.12,.12,.12);
        } else if(id==='luffy') {
          mesh(head,cylinder,graphColors[2],0,.63,-.04,1.16,.09,.96);
          mesh(head,headSphere,graphColors[2],0,.71,-.06,.75,.3,.62);
          mesh(head,cylinder,signal,0,.7,-.06,.76,.09,.63);
        } else if(id==='law') {
          mesh(head,cylinder,signal,0,.68,-.02,.9,.22,.76);
          mesh(head,cylinder,porcelain,0,.81,-.02,.92,.06,.78);
        } else if(id==='robin') {
          for(const side of [-1,1])mesh(head,headSphere,signal,side*.67,.62,-.12,.16,.35,.24);
        } else if(id==='nami') {
          for(const side of [-1,1])mesh(head,headSphere,signal,side*.88,-.05,-.24,.22,.65,.44);
        } else if(id==='jinbe') {
          mesh(head,box,signal,0,.82,-.12,.15,.24,.55);
        } else {
          // The Synthesizer's three-contact crest distinguishes the structured-output role.
          for(let i=-1;i<=1;i++)mesh(head,box,signal,i*.22,.86,0,.1,.18+(.12*(1-Math.abs(i))),.12);
        }
      } else if(shape==='globe') {
        mesh(group,cylinder,neutral,0,.24,0,.2,.48,.2);
        const globe=new THREE.Group();globe.position.set(-.12,1.28,0);globe.rotation.x=-.25;group.add(globe);
        mesh(globe,headSphere,ocean,0,0,0,.86,.86,.86);
        // Latitude / longitude rings make the globe readable without a map texture.
        for(let i=0;i<3;i++)mesh(globe,ring,graphColors[0],0,0,0,.88,.88,.88).rotation.y=i*Math.PI/3;
        for(const latitude of [-.45,0,.45]) {
          const radius=Math.sqrt(.88*.88-latitude*latitude);
          mesh(globe,ring,porcelain,0,latitude,0,radius,radius,radius).rotation.x=Math.PI/2;
        }
        const lens=new THREE.Group();lens.position.set(.67,-.07,.88);lens.rotation.z=Math.PI/4;globe.add(lens);
        mesh(lens,lensRim,pythonGold,0,0,0,.47,.47,.47);
        mesh(lens,roundedBox,mathInks[0],0,-.8,0,.19,.65,.15);
        mesh(lens,cylinder,pythonGold,0,-.49,0,.075,.14,.075);
        // Open lens: the globe stays visible through it, with no transparency pass.
      } else if(shape==='wallet') {
        const wallet=new THREE.Group();wallet.position.y=1.05;wallet.rotation.x=-.25;group.add(wallet);
        mesh(wallet,roundedBox,mathInks[0],0,0,0,2.25,1.45,.55);
        // Two cards emerge from the pocket; the front hides their lower edges.
        const card=mesh(wallet,roundedBox,graphColors[0],-.3,.6,-.06,1.22,.7,.07);card.rotation.z=.12;
        const second=mesh(wallet,roundedBox,pythonGold,.3,.52,.04,1.08,.65,.06);second.rotation.z=-.08;
        mesh(wallet,roundedBox,walletLeather,0,-.08,.25,2.25,1.25,.16);
        mesh(wallet,roundedBox,graphColors[2],.77,-.04,.38,.72,.4,.14);
        const clasp=mesh(wallet,cylinder,pythonGold,.6,-.04,.48,.1,.06,.1);clasp.rotation.x=Math.PI/2;
        for(let i=0;i<9;i++)mesh(wallet,box,porcelain,-.9+i*.22,-.59,.34,.09,.025,.015);
        for(const x of [-1.02,1.02])for(let i=0;i<4;i++)mesh(wallet,box,porcelain,x,-.4+i*.22,.34,.025,.085,.015);
        mesh(wallet,box,porcelain,-.47,.8,.01,.45,.035,.025);
        mesh(group,box,neutral,0,.18,0,.55,.36,.35);
      } else if(shape==='duo') {
        // Two compact rule-driven robots share one module, not two extra AI agents.
        for(const [i,x] of [-.65,.65].entries()) {
          const accent=i===0?graphColors[0]:graphColors[2];
          const bot=new THREE.Group();bot.position.set(x,.13,0);bot.rotation.x=-.18;group.add(bot);
          for(const side of [-1,1]) {
            mesh(bot,roundedBox,dark,side*.2,.12,.06,.25,.22,.4);
            mesh(bot,roundedBox,accent,side*.43,.51,0,.18,.4,.25);
          }
          mesh(bot,roundedBox,i===0?accent:dark,0,.46,0,.66,.56,.42);
          mesh(bot,roundedBox,porcelain,0,1.12,0,1.02,.85,.7);
          mesh(bot,roundedBox,visor,0,1.1,.37,.85,.61,.08);
          for(const side of [-1,1])mesh(bot,headSphere,accent,side*.21,1.15,.43,.075,.12,.035);
          const mouth=mesh(bot,smile,accent,0,.95,.43,.55,.4,.5);mouth.rotation.z=Math.PI;
          if(i===0) {
            mesh(bot,box,accent,0,1.48,.02,1.04,.14,.72);
            for(let j=-1;j<=1;j++)mesh(bot,roundedBox,accent,j*.23,1.64,-.03,.19,.23,.4).rotation.z=-j*.18;
            mesh(bot,box,pythonGold,-.39,.99,.43,.035,.16,.025);
          } else {
            mesh(bot,roundedBox,accent,.08,1.52,.03,.93,.18,.72);
            mesh(bot,roundedBox,accent,.32,1.32,.41,.25,.44,.1).rotation.z=-.25;
            for(const side of [-1,1])mesh(bot,box,accent,side*.09,.65,.23,.15,.11,.04).rotation.z=side*.35;
          }
          mesh(bot,box,porcelain,0,.43,.24,.12,.035,.025);
        }
      } else if(shape==='python'||shape==='react') {
        mesh(group,cylinder,neutral,0,.18,0,.18,.35,.18);
        const emblem=new THREE.Group();emblem.position.y=1.37;emblem.rotation.x=-.3;group.add(emblem);
        if(shape==='python') {
          mesh(emblem,pythonSnake,signal,0,0,0,1,1,1);
          mesh(emblem,pythonSnake,pythonGold,0,0,0,1,1,1).rotation.z=Math.PI;
        } else {
          // Three static elliptical hoops and one nucleus, no orbit animation.
          for(let i=0;i<3;i++) {
            const orbit=mesh(emblem,ring,signal,0,0,(i-1)*.065,1.18,.45,1);
            orbit.rotation.z=i*Math.PI/3;
          }
          mesh(emblem,sphere,signal,0,0,0,.19,.19,.19);
        }
      } else if(shape==='math') {
        // Bright vector-math board. The plotted marks are symbolic, not quant outputs.
        const math=new THREE.Group();math.position.y=1.3;math.rotation.x=-.28;group.add(math);
        mesh(group,box,neutral,0,.23,0,.42,.46,.35);
        mesh(math,box,signal,0,0,0,2.7,1.94,.17);
        mesh(math,box,porcelain,0,0,.1,2.56,1.8,.07);
        for(let i=0;i<9;i++)mesh(math,box,edgeMetal,-1.08+i*.27,0,.142,.012,1.52,.012);
        for(let i=0;i<6;i++)mesh(math,box,edgeMetal,0,-.675+i*.27,.142,2.3,.012,.012);
        const stroke=(a:THREE.Vector3,b:THREE.Vector3,width:number,material:THREE.Material)=>{
          const bar=mesh(math,box,material,0,0,0,width,a.distanceTo(b),width);
          bar.position.copy(a).lerp(b,.5);bar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
        };
        const arrowhead=geometry(new THREE.ConeGeometry(.075,.2,6));
        const arrow=(a:THREE.Vector3,b:THREE.Vector3,ink:THREE.Material,width:number)=>{
          const direction=b.clone().sub(a).normalize();
          stroke(a,b.clone().addScaledVector(direction,-.1),width,ink);
          const tip=mesh(math,arrowhead,ink,0,0,0,1,1,1);
          tip.position.copy(b).addScaledVector(direction,-.1);tip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
        };
        const origin=new THREE.Vector3(-.8,-.55,.19);
        arrow(new THREE.Vector3(-1.1,-.55,.19),new THREE.Vector3(1.15,-.55,.19),dark,.025);
        arrow(new THREE.Vector3(-.8,-.73,.19),new THREE.Vector3(-.8,.77,.19),dark,.025);
        arrow(origin,new THREE.Vector3(.28,.65,.22),mathInks[0],.065);
        arrow(origin,new THREE.Vector3(.98,.08,.22),mathInks[2],.065);
        // A sampled parabola, baked once into the board's material batch.
        for(let i=0;i<20;i++) {
          const point=(t:number)=>new THREE.Vector3(-.55+t*1.55,-.35+t*t*.97,.25);
          stroke(point(i/20),point((i+1)/20),.035,mathInks[1]);
        }
        mesh(math,sphere,mathInks[0],origin.x,origin.y,.23,.065,.065,.035);
        mesh(math,box,edgeMetal,0,-.94,.2,2.7,.07,.28);
        for(let i=0;i<3;i++)mesh(math,box,mathInks[i],.55+i*.19,-.885,.2,.12,.05,.07);
      } else if(shape==='candles-clock') {
        // Symbolic intraday chart and time gate, not a live price or wall clock.
        mesh(group,box,neutral,0,.22,0,.5,.44,.35);
        const chart=new THREE.Group();chart.position.y=1.23;chart.rotation.x=-.25;group.add(chart);
        mesh(chart,roundedBox,mathInks[0],-.12,0,0,2.4,1.72,.2);
        mesh(chart,box,visor,-.12,.02,.12,2.19,1.5,.04);
        for(let i=0;i<4;i++)mesh(chart,box,neutral,-.15,-.5+i*.31,.15,1.98,.012,.012);
        for(let i=0;i<5;i++) {
          const x=-.98+i*.32,y=-.28+i*.16,h=[.32,.49,.25,.45,.34][i];
          const ink=i===2?marketRed:graphColors[0];
          mesh(chart,box,ink,x,y,.19,.025,h+.25,.035);
          mesh(chart,roundedBox,ink,x,y,.21,.19,h,.055);
        }
        mesh(chart,box,graphColors[2],-.14,-.38,.17,1.96,.024,.02);
        mesh(chart,box,signal,-.79,.65,.17,.53,.045,.02);
        // Raised clock overlaps the chart corner, giving the icon a distinct silhouette.
        const clock=new THREE.Group();clock.position.set(.78,-.34,.35);chart.add(clock);
        const rim=mesh(clock,cylinder,pythonGold,0,0,0,.56,.14,.56);rim.rotation.x=Math.PI/2;
        const face=mesh(clock,cylinder,porcelain,0,0,.085,.47,.045,.47);face.rotation.x=Math.PI/2;
        for(let i=0;i<12;i++) {
          const a=i*Math.PI/6;
          const tick=mesh(clock,box,dark,Math.sin(a)*.38,Math.cos(a)*.38,.12,.024,.07,.018);tick.rotation.z=-a;
        }
        mesh(clock,box,mathInks[0],0,.14,.15,.045,.29,.025);
        const hand=mesh(clock,box,mathInks[2],.11,-.07,.16,.27,.04,.025);hand.rotation.z=-.55;
        mesh(clock,sphere,pythonGold,0,0,.18,.055,.055,.025);
      } else if(shape==='ticker') {
        const board=new THREE.Group();board.position.y=1.22;board.rotation.x=-.25;group.add(board);
        for(const x of [-.7,.7])mesh(group,box,neutral,x,.22,0,.16,.44,.24);
        mesh(board,roundedBox,ocean,0,0,0,2.8,1.72,.22);
        mesh(board,box,visor,0,0,.13,2.6,1.51,.045);
        mesh(board,box,pythonGold,-.83,.64,.17,.68,.04,.02);
        for(let i=0;i<3;i++)mesh(board,sphere,graphColors[i],.88+i*.12,.64,.18,.03,.03,.02);
        // Tiny built-in glyphs are merged geometry: no font, canvas texture or quotes feed.
        const glyphs:Record<string,string[]>={
          S:['111','100','111','001','111'],P:['110','101','110','100','100'],Y:['101','101','010','010','010'],
          Q:['111','101','101','111','001'],I:['111','010','010','010','111'],W:['101','101','111','111','101'],M:['101','111','111','101','101'],
        };
        ['SPY','QQQ','IWM'].forEach((symbol,row)=>{
          const y=.33-row*.4,ink=row===1?marketRed:graphColors[0];
          symbol.split('').forEach((letter,j)=>glyphs[letter].forEach((line,r)=>[...line].forEach((pixel,c)=>{
            if(pixel==='1')mesh(board,box,porcelain,-1.12+j*.24+c*.055,y+.11-r*.055,.18,.044,.044,.02);
          })));
          mesh(board,box,dark,0,y-.19,.17,2.36,.012,.02);
          const heights=row===1?[.1,.04,.07,-.05,-.09]:[-.08,.01,-.03,.08,.12];
          for(let i=1;i<heights.length;i++) {
            const a=new THREE.Vector3(-.24+(i-1)*.19,y+heights[i-1],.19),b=new THREE.Vector3(-.24+i*.19,y+heights[i],.19);
            const line=mesh(board,box,ink,0,0,0,.035,a.distanceTo(b),.025);
            line.position.copy(a).lerp(b,.5);line.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());
          }
          const arrow=mesh(board,geometry(new THREE.ConeGeometry(.1,.16,3)),ink,.98,y,.2,1,1,.3);
          if(row===1)arrow.rotation.z=Math.PI;
        });
      } else if(shape==='dashboard') {
        // Symbolic OHLCV glyphs only: these are not prices or a live market chart.
        mesh(group,box,neutral,0,.23,0,.5,.45,.4);
        const display=new THREE.Group();display.position.y=1.25;display.rotation.x=-.28;group.add(display);
        mesh(display,box,edgeMetal,0,0,0,2.55,1.75,.2);
        mesh(display,box,visor,0,.02,.115,2.35,1.53,.04);
        mesh(display,box,signal,-.65,.66,.15,.8,.055,.025);
        for(let i=0;i<3;i++)mesh(display,sphere,graphColors[i],.79+i*.13,.66,.15,.035,.035,.025);
        // Main candlestick pane, volume strip, and a compact multicolor summary pane.
        for(const y of [-.25,.05,.35])mesh(display,box,dark,-.35,y,.15,1.45,.014,.02);
        const candles=[[-.08,.29], [.02,.38], [.19,.23], [.1,.32], [.28,.25], [.17,.37], [.32,.2]];
        candles.forEach(([y,h],i)=>{
          const x=-.98+i*.2,ink=i===2||i===4?marketRed:graphColors[0];
          mesh(display,box,ink,x,y,.18,.025,h+.18,.03);
          mesh(display,box,ink,x,y,.2,.11,h,.045);
          const volume=.08+(i%3)*.07;
          mesh(display,box,graphColors[3],x,-.61+volume/2,.18,.12,volume,.025);
        });
        mesh(display,box,dark,.48,-.02,.16,.018,1.16,.025);
        for(let i=0;i<4;i++) {
          mesh(display,box,graphColors[i],.77,.4-i*.24,.18,.39-i*.04,.085,.03);
          mesh(display,box,edgeMetal,.67,.31-i*.24,.18,.19,.025,.02);
        }
        mesh(display,sphere,signal,0,-.81,.12,.035,.035,.02);
      } else if(shape==='graph') {
        // A symbolic map icon, not a fabricated set of saved memory entities.
        const sites=[[-.95,.35,.5],[-.75,1.35,-.25],[0,.9,0],[.8,1.65,-.35],[1,.45,.5],[.05,1.95,.15]];
        for(const [a,b] of [[0,2],[1,2],[2,3],[2,4],[1,5],[5,3]]) {
          const start=new THREE.Vector3(...sites[a]),end=new THREE.Vector3(...sites[b]);
          const link=mesh(group,cylinder,edgeMetal,0,0,0,.045,start.distanceTo(end),.045);
          link.position.copy(start).lerp(end,.5);link.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(start).normalize());
        }
        sites.forEach(([x,y,z],i)=>{
          mesh(group,sphere,graphColors[i%4],x,y,z,i===2?.32:.22,i===2?.32:.22,i===2?.32:.22);
        });
        mesh(group,cylinder,neutral,0,.27,0,.07,.6,.07);
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
      const signal=metal(identityColors[id]??LAYERS[n.layer].color,.38);const chassis=metal('#425b6c');
      group.position.copy(initialPositions.get(id)!);objects.add(group);
      const rest=positionsFor(props.mechanism,false).get(id)!;
      const stand=mesh(objects,cylinder,neutral,rest.x,(rest.y-.8-1.95)/2,rest.z,.43,rest.y+1.15,.43);
      stand.userData.node=id;clickables.push(stand);
      mesh(objects,cylinder,edgeMetal,rest.x,-1.88,rest.z,.62,.12,.62);
      mesh(group,hex,chassis,0,-.16,0,1.5,.23,1.5);
      mesh(group,hex,dark,0,-.02,0,1.36,.1,1.36);
      for(const x of [-.85,.85])for(const z of [-.85,.85])mesh(group,cylinder,edgeMetal,x,.05,z,.07,.08,.07);
      core(group,n.shape,signal,id);
      // A copper contact pad and support collar connect the module to its socket.
      mesh(group,cylinder,chassis,0,-.55,0,.7,.55,.7);
      mesh(group,cylinder,signal,0,-.27,0,.74,.045,.74);
      const halo=mesh(group,ring,signal,0,-.01,0,1.57,1.57,1.57);halo.rotation.x=Math.PI/2;
      if(n.status==='planned') { signal.wireframe=true; chassis.wireframe=true; }
      // Bake static module parts by material: hundreds of machined details, few draw calls.
      const moduleMaterials=[signal,chassis];
      const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
      group.updateMatrixWorld(true);
      const inverse=group.matrixWorld.clone().invert();
      group.traverse(child=> {
        if(!(child instanceof THREE.Mesh)||child===halo)return;
        const baked=child.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,child.matrixWorld));
        const material=child.material as THREE.Material;
        const list=batches.get(material)??[];list.push(baked);batches.set(material,list);
      });
      group.clear();group.add(halo);
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
      const labelHeight=n.shape==='agent'||n.shape==='researcher'?2.8:['graph','python','react','math','dashboard','globe','wallet','duo','candles-clock','ticker'].includes(n.shape)?2.6:1.8;
      parts.set(id,{object:group,materials:moduleMaterials,halo,position:group.position.clone(),labelHeight});
      const button=document.createElement('button');
      button.type='button';button.className='am-node-label';button.dataset.node=id;
      button.style.setProperty('--node-color',LAYERS[n.layer].color);button.dataset.status=n.status;
      const title=document.createElement('strong');title.textContent=n.name;
      const sub=document.createElement('span');sub.textContent=n.status==='planned'?'Planned':n.status==='limited'?'Known limitation':n.status==='experimental'?'Experimental comparison':n.subtitle;
      button.append(title,sub);button.setAttribute('aria-label',`${n.name}: ${n.subtitle}. Inspect component`);
      button.onclick=()=>{latest.current.onInteract();latest.current.onSelect(id);};
      root.appendChild(button);labels.set(id,button);
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
      camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);needsDraw=true;
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
      // Fixed anchors above each module; HTML keeps labels facing the viewer.
      // Overlap and viewport clipping are intentional: never shuffle or clamp tags.
      // Bead-only animation needs no label projection or DOM position updates.
      if(transitioning||needsDraw) {
        const width=root.clientWidth,height=root.clientHeight;
        for(const [id,part] of parts) {
          const label=labels.get(id)!;
          projected.copy(part.object.position);projected.y+=part.labelHeight;projected.project(camera);
          label.style.visibility=projected.z>=-1&&projected.z<=1?'visible':'hidden';
          const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
          label.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;
          label.style.zIndex=String(Math.round((1-projected.z)*10000)+(id===p.selected?1000:0));
        }
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
      sharedNeutral.length=0;renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();labels.forEach(label=>label.remove());
    };
  },[props.mechanism]);
  return <div className="am-scene-wrap">
    <div ref={mount} className="am-scene" data-renderer={failed?'fallback':'webgl'} aria-label={`Interactive 3D ${props.mechanism.short}. Use component buttons or the component index to inspect. Drag to orbit; scroll to zoom.`} />
    {failed&&<div className="am-fallback"><strong>Component explorer</strong><p>3D is unavailable on this device. Every component, connection and walkthrough remains accessible below.</p><div>{props.mechanism.nodes.map(id=><button key={id} onClick={()=>props.onSelect(id)} aria-pressed={props.selected===id}>{NODE[id].name}</button>)}</div></div>}
  </div>;
});

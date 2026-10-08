(()=>{
"use strict";
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const by=id=>document.getElementById(id);
const on=(el,event,fn,opts)=>{if(el)el.addEventListener(event,fn,opts)};

let units="mph";
let motionToken=0;
const state={
  speed:0, dir:0, currentHeading:287, desiredHeading:287, steer:0,
  anchor:false, hold:false, cruise:false, transition:false
};

function safeText(id,value){const el=by(id);if(el)el.textContent=value}
function safeClass(id,name,onState){const el=by(id);if(el)el.classList.toggle(name,onState)}
function normalize180(v){return ((v+180)%360+360)%360-180}
function normalize360(v){return ((v%360)+360)%360}

const helm=by("helm");
const thrust=by("thrustRing");
const ring=by("steerRing");
const knob=by("steerKnob");
const desiredArrow=by("desiredArrow");
const headingMarker=by("headingMarker");

if(helm&&thrust){
  thrust.innerHTML="";
  for(let n=0;n<40;n++){
    const d=document.createElement("i");
    d.className="thrustDot "+(n<20?"green":n<30?"yellow":"red");
    const radius=(helm.clientWidth/2)-20;
    d.style.transform="rotate("+(n*9)+"deg) translateY(-"+radius+"px)";
    thrust.appendChild(d);
  }
}

function angleTransform(el,angle,radius){
  if(!el)return;
  el.style.transform="translateX(-50%) rotate("+angle+"deg)";
  el.style.transformOrigin="50% "+radius+"px";
}

function render(){
  safeText("speedVal",Math.round(state.speed)+"%");
  const speedInput=by("speed"); if(speedInput)speedInput.value=state.speed;
  const mph=state.speed*0.048;
  safeText("sog",(units==="knots"?mph*0.868976:mph).toFixed(1));
  const sogUnit=q(".telemetry div:nth-child(2) em"); if(sogUnit)sogUnit.textContent=units==="knots"?"KNOTS":"MPH";
  safeText("heading",Math.round(normalize360(state.currentHeading))+"°");

  safeClass("anchor","on",state.anchor);
  safeClass("hold","on",state.hold);
  safeClass("cruise","on",state.cruise);

  const gear=state.transition?"REVERSING…":state.dir>0?"FORWARD":state.dir<0?"REVERSE":"NEUTRAL";
  safeText("direction",gear);
  const dir=by("direction");
  if(dir){
    dir.className="direction";
    if(state.dir>0)dir.classList.add("forwardDir");
    if(state.dir<0)dir.classList.add("reverseDir");
  }

  const lit=Math.round(state.speed/2.5);
  qa(".thrustDot").forEach((d,i)=>d.classList.toggle("on",i<lit));

  if(helm){
    angleTransform(knob,state.steer,helm.clientWidth/2+8);
    angleTransform(headingMarker,state.steer,helm.clientWidth/2-10);
  }
  if(desiredArrow)desiredArrow.style.transform="translate(-50%,-50%) rotate("+state.steer+"deg)";

  const amps=state.speed*0.52;
  safeText("amps",amps.toFixed(1)+" A");
  safeText("watts",Math.round(amps*37.8)+" W");
  safeText("runtime",amps>1?(76/amps).toFixed(1)+" h":"--");
}

function page(id){
  const target=by(id);
  if(!target)return;
  qa(".screen").forEach(x=>x.classList.add("hidden"));
  target.classList.remove("hidden");
  qa("nav button[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===id));
  try{window.scrollTo({top:0,behavior:"instant"})}catch(_){window.scrollTo(0,0)}
}

function setSteer(v){
  state.steer=normalize180(v);
  state.desiredHeading=normalize360(state.currentHeading+state.steer);
  render();
}

on(by("left"),"click",()=>setSteer(state.steer-10));
on(by("right"),"click",()=>setSteer(state.steer+10));
on(by("center"),"click",()=>setSteer(0));

function dial(e){
  if(!ring)return;
  const r=ring.getBoundingClientRect();
  const x=e.clientX-(r.left+r.width/2);
  const y=e.clientY-(r.top+r.height/2);
  setSteer(Math.atan2(x,-y)*180/Math.PI);
}
on(knob,"pointerdown",e=>{try{knob.setPointerCapture(e.pointerId)}catch(_){} dial(e)});
on(knob,"pointermove",e=>{if(knob&&knob.hasPointerCapture&&knob.hasPointerCapture(e.pointerId))dial(e)});

function forward(){
  motionToken++;
  state.transition=false;
  if(state.dir<0){state.speed=0;state.dir=1}
  else{state.dir=1;state.speed=Math.min(100,state.speed+10)}
  render();
}

async function reverse(){
  if(state.transition)return;
  const token=++motionToken;
  if(state.dir>0&&state.speed>0){
    state.transition=true;
    const start=state.speed;
    for(let i=1;i<=50;i++){
      await new Promise(r=>setTimeout(r,100));
      if(token!==motionToken){state.transition=false;render();return}
      state.speed=start*(1-i/50);
      render();
    }
    if(token!==motionToken)return;
    state.speed=0;
    setSteer(180);
    await new Promise(r=>setTimeout(r,500));
    if(token!==motionToken){state.transition=false;render();return}
    state.dir=-1;
    state.speed=10;
    state.transition=false;
    render();
  }else{
    state.dir=-1;
    state.speed=Math.min(100,(state.speed||0)+10);
    render();
  }
}

on(by("forward"),"click",forward);
on(by("reverse"),"click",reverse);
on(by("speed"),"input",e=>{
  motionToken++;
  state.transition=false;
  state.speed=Math.max(0,Math.min(100,Number(e.target.value)||0));
  if(state.speed===0)state.dir=0;
  else if(state.dir===0)state.dir=1;
  render();
});

on(by("anchor"),"click",()=>{state.anchor=!state.anchor;if(state.anchor)state.cruise=false;render()});
on(by("hold"),"click",()=>{state.hold=!state.hold;render()});
on(by("cruise"),"click",()=>{state.cruise=!state.cruise;if(state.cruise)state.anchor=false;render()});
on(by("stop"),"click",()=>{motionToken++;state.speed=0;state.dir=0;state.anchor=false;state.cruise=false;state.transition=false;render()});

const wpData={
  "Rock Pile":{coords:"30.12345, -83.45678",distance:286,bearing:"042°"},
  "Creek Mouth":{coords:"30.12402, -83.45531",distance:418,bearing:"071°"},
  "Trout Hole":{coords:"30.12271, -83.45744",distance:612,bearing:"198°"}
};
qa(".wp").forEach(b=>on(b,"click",()=>{
  const w=wpData[b.dataset.wp]; if(!w)return;
  safeText("wpName",b.dataset.wp);
  safeText("wpCoords",w.coords);
  safeText("wpDistance",w.distance+" ft");
  safeText("wpBearing",w.bearing);
  const go=by("goTo"); if(go){go.disabled=w.distance>500;go.textContent="GO TO";go.classList.remove("navigating")}
  safeText("goNote",w.distance>500?"Move within 500 ft to enable GO TO":"Available within 500 ft");
  const card=by("waypointCard"); if(card)card.classList.remove("hidden");
}));
on(by("closeWp"),"click",()=>{const c=by("waypointCard");if(c)c.classList.add("hidden")});
on(by("goTo"),"click",()=>{
  const go=by("goTo"); if(go){go.textContent="NAVIGATING…";go.classList.add("navigating")}
  const route=q(".routeLine"); if(route)route.classList.add("on");
  safeText("goNote","Navigating to waypoint • use STOP to cancel");
});

on(by("batteryCard"),"click",()=>page("batteryPage"));
qa(".back").forEach(b=>on(b,"click",()=>page("controlPage")));
qa("nav button[data-page]").forEach(b=>on(b,"click",()=>page(b.dataset.page)));
on(by("settingsBtn"),"click",()=>page("settingsPage"));

function menu(open){
  const drawer=by("menuDrawer"),shade=by("drawerShade");
  if(drawer)drawer.classList.toggle("hidden",!open);
  if(shade)shade.classList.toggle("hidden",!open);
}
on(by("menu"),"click",()=>menu(true));
on(by("closeMenu"),"click",()=>menu(false));
on(by("drawerShade"),"click",()=>menu(false));
qa("[data-open]").forEach(b=>on(b,"click",()=>{menu(false);page(b.dataset.open)}));

qa(".theme").forEach(b=>on(b,"click",()=>{
  qa(".theme").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.body.dataset.theme=b.dataset.theme||"dark";
}));
qa(".unit").forEach(b=>on(b,"click",()=>{
  qa(".unit").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  units=b.dataset.unit==="knots"?"knots":"mph";
  render();
}));

window.addEventListener("error",e=>console.error("TROLL runtime error",e.error||e.message));
window.addEventListener("unhandledrejection",e=>console.error("TROLL promise error",e.reason));

render();
})();
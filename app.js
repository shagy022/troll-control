(()=>{
"use strict";
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const by=id=>document.getElementById(id);
const on=(el,event,fn,opts)=>{if(el)el.addEventListener(event,fn,opts)};

let units="mph";
let motionToken=0;
const settings={throttleStep:10,gotoRadius:500,reverseSeconds:5,steerStep:10,lossAction:"stop",theme:"dark"};
try{Object.assign(settings,JSON.parse(localStorage.getItem("trollSettings")||"{}"))}catch(_){}
function saveSettings(){try{localStorage.setItem("trollSettings",JSON.stringify(settings))}catch(_){}}

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

  const gear=navigating?"EXIT AUTO PILOT":state.transition?"REVERSING…":state.dir>0?"FORWARD":state.dir<0?"REVERSE":"NEUTRAL";
  safeText("direction",gear);
  const dir=by("direction");
  if(dir){
    dir.className="direction";
    if(navigating)dir.classList.add("autopilotExit");
    else if(state.dir>0)dir.classList.add("forwardDir");
    else if(state.dir<0)dir.classList.add("reverseDir");
  }
  const leftBtn=by("left"),rightBtn=by("right"),centerBtn=by("center");
  if(leftBtn)leftBtn.disabled=navigating;
  if(rightBtn)rightBtn.disabled=navigating;
  if(centerBtn)centerBtn.disabled=navigating;
  if(helm)helm.classList.toggle("autopilotSteering",navigating);

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
  if(navigating)return;
  state.steer=normalize180(v);
  state.desiredHeading=normalize360(state.currentHeading+state.steer);
  render();
}

on(by("left"),"click",()=>setSteer(state.steer-settings.steerStep));
on(by("right"),"click",()=>setSteer(state.steer+settings.steerStep));
on(by("center"),"click",()=>setSteer(0));

function dial(e){
  if(navigating||!ring)return;
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
  else{state.dir=1;state.speed=Math.min(100,state.speed+settings.throttleStep)}
  render();
}

async function reverse(){
  if(state.transition)return;
  const token=++motionToken;
  if(state.dir>0&&state.speed>0){
    state.transition=true;
    const start=state.speed;
    const steps=Math.max(10,Math.round(settings.reverseSeconds*10));
    for(let i=1;i<=steps;i++){
      await new Promise(r=>setTimeout(r,100));
      if(token!==motionToken){state.transition=false;render();return}
      state.speed=start*(1-i/steps);
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
    state.speed=Math.min(100,(state.speed||0)+settings.throttleStep);
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
on(by("stop"),"click",()=>{motionToken++;state.speed=0;state.dir=0;state.anchor=false;state.cruise=false;state.transition=false;if(navigating){navigating=false;activeWaypointName="";const route=by("routeSvg");if(route)route.classList.remove("on");const go=by("goTo");if(go){go.textContent="GO TO";go.classList.remove("navigating")}}render()});

const wpData={
  "Rock Pile":{coords:"30.12345, -83.45678",distance:286,bearing:"042°"},
  "Creek Mouth":{coords:"30.12402, -83.45531",distance:418,bearing:"071°"},
  "Trout Hole":{coords:"30.12271, -83.45744",distance:612,bearing:"198°"}
};
let selectedWaypointEl=null;
let navigating=false;
let activeWaypointName="";

function cancelAutopilot(){
  if(!navigating)return;
  navigating=false;
  activeWaypointName="";
  motionToken++;
  const route=by("routeSvg"); if(route)route.classList.remove("on");
  const go=by("goTo"); if(go){go.textContent="GO TO";go.classList.remove("navigating")}
  safeText("goNote","Auto pilot cancelled");
  render();
}

function engageAutopilot(){
  if(!selectedWaypointEl)return;
  const name=selectedWaypointEl.dataset.wp;
  const w=wpData[name];
  if(!w||w.distance>settings.gotoRadius)return;
  navigating=true;
  activeWaypointName=name;
  state.hold=false;
  state.cruise=false;
  // In the simulator, point the commanded motor direction toward the waypoint bearing.
  const targetBearing=parseFloat(w.bearing);
  if(Number.isFinite(targetBearing)){
    state.steer=normalize180(targetBearing-state.currentHeading);
    state.desiredHeading=normalize360(targetBearing);
  }
  const go=by("goTo"); if(go){go.textContent="NAVIGATING…";go.classList.add("navigating")}
  safeText("goNote","Auto pilot active • steering locked • tap EXIT AUTO PILOT to cancel");
  render();
  requestAnimationFrame(drawRoute);
}

function drawRoute(){
  const svg=by("routeSvg"),line=by("routePath"),boat=q(".mapBoat"),map=q(".mapMock");
  if(!svg||!line||!boat||!map||!selectedWaypointEl||!navigating){if(svg)svg.classList.remove("on");return}
  const mr=map.getBoundingClientRect(),br=boat.getBoundingClientRect(),wr=selectedWaypointEl.getBoundingClientRect();
  const x1=br.left+br.width/2-mr.left, y1=br.top+br.height/2-mr.top;
  const x2=wr.left+wr.width/2-mr.left, y2=wr.top+wr.height/2-mr.top;
  line.setAttribute("x1",x1);line.setAttribute("y1",y1);line.setAttribute("x2",x2);line.setAttribute("y2",y2);
  svg.classList.add("on");
}

qa(".wp").forEach(b=>on(b,"click",()=>{
  selectedWaypointEl=b;
  const w=wpData[b.dataset.wp]; if(!w)return;
  safeText("wpName",b.dataset.wp);
  safeText("wpCoords",w.coords);
  safeText("wpDistance",w.distance+" ft");
  safeText("wpBearing",w.bearing);
  const go=by("goTo");
  if(go){go.disabled=w.distance>settings.gotoRadius;go.textContent=navigating?"NAVIGATING…":"GO TO";go.classList.toggle("navigating",navigating)}
  safeText("goNote",w.distance>settings.gotoRadius?"Move within "+settings.gotoRadius+" ft to enable GO TO":"Available within "+settings.gotoRadius+" ft");
  const card=by("waypointCard"); if(card)card.classList.remove("hidden");
  if(navigating)requestAnimationFrame(drawRoute);
}));
on(by("closeWp"),"click",()=>{const c=by("waypointCard");if(c)c.classList.add("hidden")});
on(by("goTo"),"click",engageAutopilot);
on(by("direction"),"click",()=>{if(navigating)cancelAutopilot()});
on(window,"resize",()=>requestAnimationFrame(drawRoute));

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

function syncSettingsUI(){
  units=settings.units==="knots"?"knots":"mph";
  document.body.dataset.theme=settings.theme||"dark";
  qa(".theme").forEach(x=>x.classList.toggle("active",x.dataset.theme===settings.theme));
  qa(".unit").forEach(x=>x.classList.toggle("active",x.dataset.unit===units));
  const ts=by("throttleStep"),gr=by("gotoRadius"),rs=by("reverseSeconds"),ss=by("steerStep"),la=by("lossAction");
  if(ts)ts.value=String(settings.throttleStep);
  if(gr)gr.value=String(settings.gotoRadius);
  if(rs)rs.value=String(settings.reverseSeconds);
  if(ss)ss.value=String(settings.steerStep);
  if(la)la.value=settings.lossAction;
}
qa(".theme").forEach(b=>on(b,"click",()=>{
  settings.theme=b.dataset.theme||"dark";saveSettings();syncSettingsUI();
}));
qa(".unit").forEach(b=>on(b,"click",()=>{
  settings.units=b.dataset.unit==="knots"?"knots":"mph";saveSettings();syncSettingsUI();render();
}));
on(by("throttleStep"),"change",e=>{settings.throttleStep=Math.max(5,Math.min(20,Number(e.target.value)||10));saveSettings()});
on(by("gotoRadius"),"change",e=>{settings.gotoRadius=Math.max(100,Math.min(2000,Number(e.target.value)||500));e.target.value=settings.gotoRadius;saveSettings()});
on(by("reverseSeconds"),"change",e=>{settings.reverseSeconds=Math.max(1,Math.min(10,Number(e.target.value)||5));e.target.value=settings.reverseSeconds;saveSettings()});
on(by("steerStep"),"change",e=>{settings.steerStep=Math.max(5,Math.min(20,Number(e.target.value)||10));saveSettings()});
on(by("lossAction"),"change",e=>{settings.lossAction=e.target.value==="neutral"?"neutral":"stop";saveSettings()});
syncSettingsUI();

window.addEventListener("error",e=>console.error("TROLL runtime error",e.error||e.message));
window.addEventListener("unhandledrejection",e=>console.error("TROLL promise error",e.reason));

render();
})();
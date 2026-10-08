(()=>{
"use strict";
const q=s=>document.querySelector(s);
const qa=s=>Array.from(document.querySelectorAll(s));
const by=id=>document.getElementById(id);
const on=(el,event,fn,opts)=>{if(el)el.addEventListener(event,fn,opts)};

let units="mph";
let motionToken=0;
let zigTimer=null;
let zigLeg="diag";
let zigFeet=0;
let zigBaseHeading=0;
let spotTimer=null;
let spotDx=0;
let spotDy=0;
const settings={throttleStep:10,gotoRadius:500,reverseSeconds:5,steerStep:10,signalLossSeconds:5,autoSteerSeconds:5,motorHomeOffset:0,theme:"dark"};
try{Object.assign(settings,JSON.parse(localStorage.getItem("trollSettings")||"{}"))}catch(_){} const allowedThemes=["dark","classic","gunmetal","deepsea","nightvision","highvis"];if(!allowedThemes.includes(settings.theme))settings.theme="dark";
function saveSettings(){try{localStorage.setItem("trollSettings",JSON.stringify(settings))}catch(_){}}

const state={
  speed:0, dir:0, currentHeading:287, desiredHeading:287, steer:0,
  anchor:false, hold:false, cruise:false, zigTroll:false, spotAccuracy:"medium", transition:false, transitionTarget:0, signalLost:false
};

function safeText(id,value){const el=by(id);if(el)el.textContent=value}
function safeClass(id,name,onState){const el=by(id);if(el)el.classList.toggle(name,onState)}
function normalize180(v){return ((v+180)%360+360)%360-180}
function normalize360(v){return ((v%360)+360)%360}
function clampManualSteer(v){
  const a=normalize180(v);
  if(state.dir<0){
    // Reverse manual steering: rear half only, 3:00 -> 6:00 -> 9:00.
    if(a>=90||a<=-90)return a;
    return state.steer>=0?90:-90;
  }
  // Forward/neutral manual steering: front half only, 9:00 -> 12:00 -> 3:00.
  if(a>=-90&&a<=90)return a;
  return state.steer>=0?90:-90;
}
let autoSteerToken=0;
async function smoothAutoSteer(target,durationSeconds=settings.autoSteerSeconds){
  const token=++autoSteerToken;
  const start=normalize180(state.steer);
  const end=normalize180(target);
  const delta=normalize180(end-start);
  const ms=Math.max(100,Number(durationSeconds||5)*1000);
  const steps=Math.max(1,Math.round(ms/50));
  for(let i=1;i<=steps;i++){
    await new Promise(r=>setTimeout(r,50));
    if(token!==autoSteerToken||state.signalLost)return;
    state.steer=normalize180(start+delta*(i/steps));
    state.desiredHeading=normalize360(state.currentHeading+state.steer);
    render();
  }
}

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
    const radius=Math.max(20,(thrust.clientWidth/2)-4);
    d.style.transform="rotate("+(n*9)+"deg) translateY(-"+radius+"px)";
    thrust.appendChild(d);
  }
}

function positionOnSteerRing(el,angle,radius,rotate){
  if(!el||!ring||ring.clientWidth<20||ring.clientHeight<20)return;
  const rad=angle*Math.PI/180;
  const cx=ring.clientWidth/2;
  const cy=ring.clientHeight/2;
  const x=cx+Math.sin(rad)*radius;
  const y=cy-Math.cos(rad)*radius;
  el.style.left=x+"px";
  el.style.top=y+"px";
  el.style.transform="translate(-50%,-50%)"+(rotate?" rotate("+angle+"deg)":"");
  el.style.transformOrigin="50% 50%";
}

function render(){
  safeText("speedVal",Math.round(state.speed)+"%");
  const speedInput=by("speed"); if(speedInput)speedInput.value=state.speed;
  const mph=state.speed*0.048;
  safeText("sog",(units==="knots"?mph*0.868976:mph).toFixed(1));
  const sogUnit=q(".telemetry div:nth-child(2) em"); if(sogUnit)sogUnit.textContent=units==="knots"?"KNOTS":"MPH";
  safeText("heading",Math.round(normalize360(state.currentHeading))+"°");

  safeClass("anchor","on",state.anchor);
  const helmWrap=q(".helmWrap");
  const spotPanel=by("spotLockPanel");
  const directionEl=by("direction");
  if(helmWrap)helmWrap.classList.toggle("hidden",state.anchor);
  if(spotPanel)spotPanel.classList.toggle("hidden",!state.anchor);
  qa(".accuracyBtns button").forEach(b=>b.classList.toggle("active",b.dataset.accuracy===state.spotAccuracy));
  safeClass("hold","on",state.hold);
  safeClass("cruise","on",state.cruise);
  safeClass("zig","on",state.zigTroll);

  const gear=state.signalLost?"NO SIGNAL MANUAL ONLY":state.zigTroll?"SCOUT TROLL AUTOPILOT":navigating?"EXIT AUTO PILOT":state.transition?(state.transitionTarget>0?"SHIFTING TO FORWARD…":"SHIFTING TO REVERSE…"):state.dir>0?"FORWARD":state.dir<0?"REVERSE":"NEUTRAL";
  safeText("direction",gear);
  const dir=by("direction");
  if(dir){
    dir.className="direction";
    if(state.signalLost)dir.classList.add("noSignal");
    else if(navigating||state.zigTroll)dir.classList.add("autopilotExit");
    else if(state.dir>0)dir.classList.add("forwardDir");
    else if(state.dir<0)dir.classList.add("reverseDir");
    dir.classList.toggle("hidden",state.anchor);
  }
  const controlPage=by("controlPage");
  if(controlPage)controlPage.classList.toggle("spotLockActive",state.anchor);
  if(helm){
    helm.classList.toggle("forwardRange",!state.anchor&&state.dir>=0);
    helm.classList.toggle("reverseRange",!state.anchor&&state.dir<0);
  }

  const connection=by("connectionStatus");
  if(connection){
    connection.textContent=state.signalLost?"NO SIGNAL":"SIMULATOR CONNECTED";
    connection.classList.toggle("noSignalStatus",state.signalLost);
  }

  const steeringLocked=navigating||state.zigTroll||state.anchor||state.signalLost;
  const leftBtn=by("left"),rightBtn=by("right");
  if(leftBtn)leftBtn.disabled=steeringLocked;
  if(rightBtn)rightBtn.disabled=steeringLocked;
  if(helm)helm.classList.toggle("autopilotSteering",navigating||state.zigTroll);

  ["forward","reverse","speed","cruise","anchor","hold","zig"].forEach(id=>{
    const el=by(id); if(!el)return;
    const waypointLocked=navigating&&(id==="anchor"||id==="hold"||id==="zig");
    const zigLocked=state.zigTroll&&(id==="forward"||id==="reverse"||id==="cruise"||id==="anchor"||id==="hold");
    const spotLocked=state.anchor&&(id==="forward"||id==="reverse"||id==="speed"||id==="cruise"||id==="hold"||id==="zig");
    const locked=state.signalLost||waypointLocked||zigLocked||spotLocked;
    el.disabled=locked;
    el.classList.toggle("motorLocked",locked);
  });
  const goBtn=by("goTo");
  if(goBtn&&state.signalLost){goBtn.disabled=true;goBtn.classList.add("motorLocked")}
  const simBtn=by("simulateSignal");
  if(simBtn){
    simBtn.textContent=state.signalLost?"RESTORE SIGNAL":"SIMULATE SIGNAL LOSS";
    simBtn.classList.toggle("restore",state.signalLost);
  }

  const lit=Math.round(state.speed/2.5);
  qa(".thrustDot").forEach((d,i)=>d.classList.toggle("on",i<lit));

  const visualSteer=(state.dir<0&&state.steer<0)?state.steer+360:state.steer;
  if(ring){
    positionOnSteerRing(knob,visualSteer,ring.clientWidth/2-2,false);
    positionOnSteerRing(headingMarker,visualSteer,ring.clientWidth/2-22,true);
  }
  if(desiredArrow)desiredArrow.style.transform="translate(-50%,-50%) rotate("+visualSteer+"deg)";

  const amps=state.speed*0.52;
  safeText("amps",amps.toFixed(1)+" A");
  safeText("liveAmps",amps.toFixed(1)+" A");
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
  if(id==="controlPage")requestAnimationFrame(render);
}

function setSteer(v){
  if(navigating||state.zigTroll||state.anchor||state.signalLost)return;
  state.steer=clampManualSteer(v);
  state.desiredHeading=normalize360(state.currentHeading+state.steer);
  render();
}

on(by("left"),"click",()=>setSteer(state.steer-settings.steerStep));
on(by("right"),"click",()=>setSteer(state.steer+settings.steerStep));

function dial(e){
  if(navigating||state.zigTroll||state.anchor||state.signalLost||!ring||helmBoundaryLocked)return;
  const r=ring.getBoundingClientRect();
  const x=e.clientX-(r.left+r.width/2);
  const y=e.clientY-(r.top+r.height/2);
  const raw=Math.atan2(x,-y)*180/Math.PI;
  const a=normalize180(raw);
  const forbidden=state.dir<0 ? (a>-90&&a<90) : (a>90||a<-90);
  if(forbidden){
    // Stop this drag at the 3:00/9:00 safety boundary.
    // Do not jump across to the opposite boundary during the same gesture.
    state.steer=state.steer>=0?90:-90;
    state.desiredHeading=normalize360(state.currentHeading+state.steer);
    helmBoundaryLocked=true;
    render();
    return;
  }
  setSteer(a);
}
let helmSteerPointer=null;
let helmBoundaryLocked=false;
function beginHelmSteer(e){
  if(navigating||state.zigTroll||state.anchor||state.signalLost)return;
  if(e.target.closest&&e.target.closest("button"))return;
  helmBoundaryLocked=false;
  helmSteerPointer=e.pointerId;
  try{helm.setPointerCapture(e.pointerId)}catch(_){}
  dial(e);
}
function moveHelmSteer(e){
  if(helmSteerPointer!==e.pointerId)return;
  dial(e);
}
function endHelmSteer(e){
  if(helmSteerPointer!==e.pointerId)return;
  helmSteerPointer=null;
  helmBoundaryLocked=false;
  try{helm.releasePointerCapture(e.pointerId)}catch(_){}
}
on(helm,"pointerdown",beginHelmSteer);
on(helm,"pointermove",moveHelmSteer);
on(helm,"pointerup",endHelmSteer);
on(helm,"pointercancel",endHelmSteer);

async function changeDirection(targetDir){
  if(state.signalLost||state.transition)return;

  // Same direction: each tap simply adds the configured throttle step.
  if(state.dir===targetDir){
    state.speed=Math.min(100,state.speed+settings.throttleStep);
    render();
    return;
  }

  const token=++motionToken;
  state.transition=true;
  state.transitionTarget=targetDir;
  const start=state.speed;

  // Any powered direction change ramps smoothly to zero first.
  if(start>0){
    const steps=Math.max(10,Math.round(settings.reverseSeconds*10));
    for(let i=1;i<=steps;i++){
      await new Promise(r=>setTimeout(r,100));
      if(token!==motionToken){
        state.transition=false;state.transitionTarget=0;
        render();
        return;
      }
      state.speed=start*(1-i/steps);
      render();
    }
  }

  if(token!==motionToken)return;
  state.speed=0;

  // Direction changes always center the motor before thrust resumes:
  // Forward = 12:00 / 0°, Reverse = 6:00 / 180°.
  const targetSteer=targetDir<0?180:0;
  const needsCenter=Math.abs(normalize180(state.steer-targetSteer))>.5;
  if(needsCenter){
    state.steer=targetSteer;
    state.desiredHeading=normalize360(state.currentHeading+state.steer);
    render();
    await new Promise(r=>setTimeout(r,500));
  }

  if(token!==motionToken){
    state.transition=false;state.transitionTarget=0;
    render();
    return;
  }

  state.dir=targetDir;
  state.speed=settings.throttleStep;
  state.transition=false;state.transitionTarget=0;
  render();
}

function forward(){changeDirection(1)}
function reverse(){changeDirection(-1)}

on(by("forward"),"click",forward);
on(by("reverse"),"click",reverse);
on(by("speed"),"input",e=>{
  if(state.signalLost||state.anchor)return;
  motionToken++;
  state.transition=false;state.transitionTarget=0;
  state.speed=Math.max(0,Math.min(100,Number(e.target.value)||0));
  if(state.speed===0)state.dir=0;
  else if(state.dir===0)state.dir=1;
  render();
});


function applyZigLeg(){
  const offset=zigLeg==="diag"?45:-90; // 1:30 then 9:00, relative to heading captured at start
  const targetBearing=normalize360(zigBaseHeading+offset);
  const targetSteer=normalize180(targetBearing-state.currentHeading);
  smoothAutoSteer(targetSteer,settings.autoSteerSeconds);
}
function cancelZigTroll(){
  autoSteerToken++;
  if(zigTimer){clearInterval(zigTimer);zigTimer=null}
  if(!state.zigTroll)return;
  state.zigTroll=false;
  zigFeet=0;
  zigLeg="diag";
  state.speed=0;
  state.dir=0;
  render();
}
function startZigTroll(){
  if(state.signalLost||state.zigTroll)return;
  if(navigating)cancelAutopilot();
  if(spotTimer){clearInterval(spotTimer);spotTimer=null}
  state.anchor=false;
  state.hold=false;
  state.cruise=false;
  state.zigTroll=true;
  state.transition=false;
  state.transitionTarget=0;
  state.dir=1;
  state.speed=50;
  zigBaseHeading=normalize360(state.currentHeading);
  zigLeg="diag";
  zigFeet=0;
  applyZigLeg();
  if(zigTimer)clearInterval(zigTimer);
  zigTimer=setInterval(()=>{
    if(!state.zigTroll||state.signalLost)return;
    const mph=state.speed*0.048;
    const feetPerTick=mph*1.46667*0.1;
    zigFeet+=feetPerTick;
    const targetFeet=zigLeg==="diag"?75:50;
    if(zigFeet>=targetFeet){
      zigFeet=0;
      zigLeg=zigLeg==="diag"?"left":"diag";
      applyZigLeg();
    }
  },100);
}

function updateSpotDisplay(){
  const dot=by("spotBoatDot"),field=by("spotField");
  if(!dot||!field)return;
  const radius=field.clientWidth*.44;
  const scale=radius/10;
  const x=field.clientWidth/2+spotDx*scale;
  const y=field.clientHeight/2-spotDy*scale;
  dot.style.left=x+"px";
  dot.style.top=y+"px";
  safeText("spotDistance",Math.hypot(spotDx,spotDy).toFixed(1)+" ft");
}
function startSpotSimulation(){
  if(spotTimer)clearInterval(spotTimer);
  spotDx=1.2;spotDy=-.8;
  updateSpotDisplay();
  spotTimer=setInterval(()=>{
    if(!state.anchor||state.signalLost)return;
    const limit=state.spotAccuracy==="high"?3:state.spotAccuracy==="medium"?6:10;
    const d=Math.hypot(spotDx,spotDy);
    const correction=d>0?Math.min(.7,d*.22):0;
    spotDx+=(Math.random()-.5)*1.4-(spotDx/(d||1))*correction;
    spotDy+=(Math.random()-.5)*1.4-(spotDy/(d||1))*correction;
    const nd=Math.hypot(spotDx,spotDy);
    if(nd>limit*.92){
      const f=(limit*.86)/nd;
      spotDx*=f;spotDy*=f;
    }
    updateSpotDisplay();
  },700);
}
function startSpotLock(){
  if(state.signalLost||navigating||state.zigTroll)return;
  motionToken++;
  autoSteerToken++;
  state.anchor=true;
  state.hold=false;
  state.cruise=false;
  state.speed=0;
  state.dir=0;
  startSpotSimulation();
  render();
}
function stopSpotLock(){
  if(spotTimer){clearInterval(spotTimer);spotTimer=null}
  state.anchor=false;
  spotDx=0;spotDy=0;
  state.speed=0;
  state.dir=0;
  render();
}
on(by("anchor"),"click",()=>state.anchor?stopSpotLock():startSpotLock());
on(by("hold"),"click",()=>{if(state.signalLost||navigating||state.zigTroll)return;state.hold=!state.hold;render()});
on(by("cruise"),"click",()=>{if(state.signalLost||state.zigTroll)return;state.cruise=!state.cruise;if(state.cruise)state.anchor=false;render()});
qa(".accuracyBtns button").forEach(b=>on(b,"click",()=>{state.spotAccuracy=b.dataset.accuracy||"medium";render();}));
on(by("exitSpotLock"),"click",stopSpotLock);
on(by("zig"),"click",()=>state.zigTroll?cancelZigTroll():startZigTroll());
on(by("stop"),"click",()=>{if(spotTimer){clearInterval(spotTimer);spotTimer=null}autoSteerToken++;if(state.zigTroll)cancelZigTroll();motionToken++;if(zigTimer){clearInterval(zigTimer);zigTimer=null} state.zigTroll=false;zigFeet=0;zigLeg="diag"; if(spotTimer){clearInterval(spotTimer);spotTimer=null} state.speed=0;state.dir=0;state.anchor=false;state.hold=false;state.cruise=false;state.transition=false;state.transitionTarget=0;if(navigating){navigating=false;activeWaypointName="";const route=by("routeSvg");if(route)route.classList.remove("on");const go=by("goTo");if(go){go.textContent="GO TO";go.classList.remove("navigating")}}render()});

const wpData={
  "Rock Pile":{coords:"30.12345, -83.45678",distance:286,bearing:"042°"},
  "Creek Mouth":{coords:"30.12402, -83.45531",distance:418,bearing:"071°"},
  "Trout Hole":{coords:"30.12271, -83.45744",distance:612,bearing:"198°"}
};
let selectedWaypointEl=null;
let navigating=false;
let activeWaypointName="";

function cancelAutopilot(){
  autoSteerToken++;
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
  if(state.signalLost||!selectedWaypointEl)return;
  if(state.zigTroll)cancelZigTroll();
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
    smoothAutoSteer(normalize180(targetBearing-state.currentHeading),settings.autoSteerSeconds);
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
on(by("direction"),"click",()=>{if(state.signalLost)return;if(state.zigTroll)cancelZigTroll();else if(navigating)cancelAutopilot()});
on(window,"resize",()=>requestAnimationFrame(drawRoute));


async function loseSignal(){
  if(state.signalLost)return;
  const token=++motionToken;
  state.signalLost=true;
  autoSteerToken++;
  state.transition=false;state.transitionTarget=0;
  state.anchor=false;
  state.hold=false;
  state.cruise=false;
  if(zigTimer){clearInterval(zigTimer);zigTimer=null}
  state.zigTroll=false;zigFeet=0;zigLeg="diag";
  if(navigating){
    navigating=false;
    activeWaypointName="";
    const route=by("routeSvg");if(route)route.classList.remove("on");
    const go=by("goTo");if(go){go.textContent="GO TO";go.classList.remove("navigating")}
  }
  const start=state.speed;
  const steps=Math.max(10,Math.round(settings.signalLossSeconds*10));
  render();
  for(let i=1;i<=steps;i++){
    await new Promise(r=>setTimeout(r,100));
    if(token!==motionToken||!state.signalLost)return;
    state.speed=start*(1-i/steps);
    render();
  }
  if(token!==motionToken||!state.signalLost)return;
  state.speed=0;
  state.dir=0;
  render();
}
function restoreSignal(){
  motionToken++;
  state.signalLost=false;
  state.transition=false;state.transitionTarget=0;
  render();
}
on(by("simulateSignal"),"click",()=>state.signalLost?restoreSignal():loseSignal());

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


let calibrationRunning=false;
let calibrationTempOffset=0;
let calibrationToken=0;

function showCalStep(id){
  ["calStepWarn","calStepSweep","calStepAdjust","calStepConfirm"].forEach(x=>{const el=by(x);if(el)el.classList.toggle("hidden",x!==id)});
}
function openCalibration(){
  if(state.signalLost)return;
  calibrationRunning=false;
  calibrationTempOffset=Number(settings.motorHomeOffset)||0;
  safeText("calOffset",Math.round(calibrationTempOffset)+"°");
  showCalStep("calStepWarn");
  const ov=by("calibrationOverlay");if(ov)ov.classList.remove("hidden");
}
function closeCalibration(){
  calibrationToken++;
  calibrationRunning=false;
  const ov=by("calibrationOverlay");if(ov)ov.classList.add("hidden");
}
async function runCalibrationSweep(){
  if(calibrationRunning)return;
  calibrationRunning=true;
  const token=++calibrationToken;
  motionToken++;
  state.speed=0;state.dir=0;state.anchor=false;state.hold=false;state.cruise=false;state.transition=false;state.transitionTarget=0;
  if(navigating)cancelAutopilot();
  render();
  showCalStep("calStepSweep");
  const needle=by("calNeedle");
  for(let deg=0;deg<=360;deg+=6){
    await new Promise(r=>setTimeout(r,45));
    if(token!==calibrationToken)return;
    if(needle)needle.style.transform="rotate("+deg+"deg)";
    safeText("calAngle",deg+"°");
  }
  for(let deg=360;deg>=0;deg-=12){
    await new Promise(r=>setTimeout(r,25));
    if(token!==calibrationToken)return;
    if(needle)needle.style.transform="rotate("+deg+"deg)";
    safeText("calAngle",(deg%360)+"°");
  }
  calibrationTempOffset=Number(settings.motorHomeOffset)||0;
  safeText("calOffset",Math.round(calibrationTempOffset)+"°");
  calibrationRunning=false;
  showCalStep("calStepAdjust");
}
function nudgeCalibration(delta){
  if(calibrationRunning)return;
  calibrationTempOffset=normalize180(calibrationTempOffset+delta);
  safeText("calOffset",Math.round(calibrationTempOffset)+"°");
  // Simulator preview: represent the motor's physical adjustment on the helm.
  state.steer=calibrationTempOffset;
  state.desiredHeading=normalize360(state.currentHeading+state.steer);
  render();
}
function saveCalibration(){
  settings.motorHomeOffset=normalize180(calibrationTempOffset);
  saveSettings();
  syncSettingsUI();
  state.steer=0;
  state.desiredHeading=state.currentHeading;
  if(knob){knob.style.left="50%";knob.style.top="-8px";knob.style.transform="translateX(-50%)"}
  if(headingMarker){headingMarker.style.left="50%";headingMarker.style.top="10px";headingMarker.style.transform="translateX(-50%)"}
  closeCalibration();
}

on(by("calibrateSteering"),"click",openCalibration);
on(by("calCancel"),"click",closeCalibration);
on(by("calStart"),"click",runCalibrationSweep);
on(by("calLeft"),"click",()=>nudgeCalibration(-1));
on(by("calRight"),"click",()=>nudgeCalibration(1));
on(by("calConfirm"),"click",()=>showCalStep("calStepConfirm"));
on(by("calNo"),"click",()=>showCalStep("calStepAdjust"));
on(by("calYes"),"click",saveCalibration);

function syncSettingsUI(){
  units=settings.units==="knots"?"knots":"mph";
  document.body.dataset.theme=settings.theme||"dark";
  qa(".theme").forEach(x=>x.classList.toggle("active",x.dataset.theme===settings.theme));
  qa(".unit").forEach(x=>x.classList.toggle("active",x.dataset.unit===units));
  const ts=by("throttleStep"),gr=by("gotoRadius"),rs=by("reverseSeconds"),ss=by("steerStep"),sl=by("signalLossSeconds"),as=by("autoSteerSeconds");
  if(ts)ts.value=String(settings.throttleStep);
  if(gr)gr.value=String(settings.gotoRadius);
  if(rs)rs.value=String(settings.reverseSeconds);
  if(ss)ss.value=String(settings.steerStep);
  if(sl)sl.value=String(settings.signalLossSeconds);
  if(as)as.value=String(settings.autoSteerSeconds);
  safeText("homeOffsetStatus","Home offset: "+Math.round(settings.motorHomeOffset||0)+"°");
}
qa(".theme").forEach(b=>on(b,"click",()=>{
  settings.theme=allowedThemes.includes(b.dataset.theme)?b.dataset.theme:"dark";saveSettings();syncSettingsUI();
}));
qa(".unit").forEach(b=>on(b,"click",()=>{
  settings.units=b.dataset.unit==="knots"?"knots":"mph";saveSettings();syncSettingsUI();render();
}));
on(by("throttleStep"),"change",e=>{settings.throttleStep=Math.max(5,Math.min(20,Number(e.target.value)||10));saveSettings()});
on(by("gotoRadius"),"change",e=>{settings.gotoRadius=Math.max(100,Math.min(1000,Number(e.target.value)||500));e.target.value=settings.gotoRadius;saveSettings()});
on(by("reverseSeconds"),"change",e=>{settings.reverseSeconds=Math.max(2,Math.min(10,Number(e.target.value)||5));e.target.value=settings.reverseSeconds;saveSettings()});
on(by("steerStep"),"change",e=>{settings.steerStep=Math.max(5,Math.min(20,Number(e.target.value)||10));saveSettings()});
on(by("signalLossSeconds"),"change",e=>{settings.signalLossSeconds=Math.max(2,Math.min(10,Number(e.target.value)||5));e.target.value=settings.signalLossSeconds;saveSettings()});
on(by("autoSteerSeconds"),"change",e=>{settings.autoSteerSeconds=Math.max(2,Math.min(15,Number(e.target.value)||5));e.target.value=settings.autoSteerSeconds;saveSettings()});
const settingHelp=[
  {
    match:a=>a.querySelector(".themeBtns"),
    title:"Color Theme",
    text:"Changes only the app appearance. It does not change motor behavior. Choose any of the six built-in themes; there is no numeric range."
  },
  {
    match:a=>a.querySelector(".toggleBtns"),
    title:"Speed Units",
    text:"Changes speed display between MPH and knots. This affects display units only, not motor output or autopilot behavior."
  },
  {
    match:a=>a.querySelector("#throttleStep"),
    title:"Throttle Step",
    text:"Controls how much each Forward or Reverse tap changes commanded throttle. Allowed choices: 5%, 10%, 15%, or 20% per tap. Smaller steps give finer control; larger steps reach high power faster."
  },
  {
    match:a=>a.querySelector("#gotoRadius"),
    title:"Go-To Safety Radius",
    text:"Maximum distance from the boat at which GO TO may be started. Allowed range: 100–1,000 ft in 50 ft steps. A smaller radius keeps autonomous runs closer to the boat; a larger radius permits farther waypoint runs."
  },
  {
    match:a=>a.querySelector("#reverseSeconds"),
    title:"Direction Change Ramp",
    text:"Time used to reduce thrust to zero before changing between Forward and Reverse. Allowed range: 2–10 seconds. Shorter is more responsive; longer is gentler on the motor, mount, wiring, and boat."
  },
  {
    match:a=>a.querySelector("#steerStep"),
    title:"Steering Step",
    text:"Changes how far the left/right steering buttons move the motor per tap. Allowed choices: 5°, 10°, 15°, or 20°. Smaller steps give finer aiming; larger steps turn faster."
  },
  {
    match:a=>a.querySelector("#autoSteerSeconds"),
    title:"Autopilot Steering Ramp",
    text:"Time for waypoint and Scout Troll heading changes to sweep smoothly to a new heading. Allowed range: 2–15 seconds. Shorter turns more aggressively; longer turns more gently. Spot Lock and manual steering are intentionally not slowed by this setting."
  },
  {
    match:a=>a.querySelector("#signalLossSeconds"),
    title:"Signal-Loss Ramp Down",
    text:"Time used to reduce propulsion to zero after control signal is lost. Allowed range: 2–10 seconds. Shorter stops propulsion sooner; longer makes the slowdown gentler. The real safety version must run onboard, not on the phone."
  },
  {
    match:a=>a.querySelector("#simulateSignal"),
    title:"Signal-Loss Test",
    text:"Simulator-only test for the loss-of-signal behavior. It lets you verify the warning state and ramp-down response without disconnecting real hardware."
  },
  {
    match:a=>a.querySelector("#calibrateSteering"),
    title:"Motor Steering Calibration",
    text:"Sets the physical motor position that counts as straight ahead / 12:00 for this boat and mount. Calibration should always be done with propulsion at zero and with the steering area clear."
  },
  {
    match:a=>a.textContent.includes("Motor Controller"),
    title:"Motor Controller",
    text:"Shows the currently connected propulsion controller. It is read-only in the simulator. Real hardware status and controller faults will appear here later."
  },
  {
    match:a=>a.textContent.includes("Battery BMS"),
    title:"Battery BMS",
    text:"Shows the Bluetooth battery-management-system connection. When supported, it can provide live voltage, current draw, state of charge, temperatures, cell data, and alarms."
  }
];
function showSettingHelp(title,body){
  safeText("helpTitle",title);
  safeText("helpText",body);
  const ov=by("helpOverlay");if(ov)ov.classList.remove("hidden");
}
qa("#settingsPage .settingsList article").forEach(article=>{
  const info=settingHelp.find(x=>x.match(article));
  if(!info)return;
  const btn=document.createElement("button");
  btn.type="button";btn.className="settingInfoBtn";btn.textContent="🔍";
  btn.setAttribute("aria-label","About "+info.title);
  btn.title="About "+info.title;
  on(btn,"click",()=>showSettingHelp(info.title,info.text));
  article.appendChild(btn);
});
on(by("helpClose"),"click",()=>{const ov=by("helpOverlay");if(ov)ov.classList.add("hidden")});
on(by("helpOverlay"),"click",e=>{if(e.target===by("helpOverlay"))by("helpOverlay").classList.add("hidden")});

function enforceNumberRange(id,min,max,step,fallback){
  const el=by(id);if(!el)return;
  const clamp=()=>{
    let v=Number(el.value);
    if(!Number.isFinite(v))v=fallback;
    v=Math.max(min,Math.min(max,v));
    if(step>0)v=Math.round(v/step)*step;
    v=Math.max(min,Math.min(max,v));
    el.value=String(v);
    el.setCustomValidity("");
  };
  on(el,"change",clamp);
  on(el,"blur",clamp);
  on(el,"keydown",e=>{
    if(["e","E","+","-"].includes(e.key))e.preventDefault();
  });
}
enforceNumberRange("gotoRadius",100,1000,50,500);
enforceNumberRange("reverseSeconds",2,10,1,5);
enforceNumberRange("autoSteerSeconds",2,15,1,5);
enforceNumberRange("signalLossSeconds",2,10,1,5);

syncSettingsUI();

window.addEventListener("error",e=>console.error("TROLL runtime error",e.error||e.message));
window.addEventListener("unhandledrejection",e=>console.error("TROLL promise error",e.reason));

render();
})();
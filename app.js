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
let spotCorrecting=false;
let steeringFaultSince=0;
let resumeTimer=null;
let resumeSeconds=0;
let resumeState=null;
let preflightMode="checking"; // checking | ready | manualOnly | locked
let preflightComplete=false;
const preflightChecks=[
  {id:"controlLink",label:"Control Link",detail:"Command link / failsafe communication",safety:true,pass:true},
  {id:"motorController",label:"Motor Controller",detail:"Propulsion controller ready",safety:true,pass:true},
  {id:"steeringFeedback",label:"Steering Feedback",detail:"Motor angle sensor responding",safety:true,pass:true},
  {id:"batteryPower",label:"Battery Power",detail:"Voltage and power system within safe range",safety:true,pass:true},
  {id:"gpsFix",label:"GPS Fix",detail:"Required for Spot Lock and autonomous navigation",safety:false,pass:true},
  {id:"compass",label:"Compass / Heading",detail:"Required for heading-based autopilot modes",safety:false,pass:true}
];
const settings={throttleStep:10,gotoRadius:500,gotoMaxThrottle:75,gotoSlowdownDistance:25,reverseSeconds:5,steerStep:10,steeringFaultTolerance:15,signalLossSeconds:5,autoSteerSeconds:5,motorHomeOffset:0,theme:"dark"};
try{Object.assign(settings,JSON.parse(localStorage.getItem("trollSettings")||"{}"))}catch(_){} const allowedThemes=["dark","classic","gunmetal","deepsea","nightvision","highvis"];if(!allowedThemes.includes(settings.theme))settings.theme="dark";
if(![50,75,100].includes(Number(settings.gotoMaxThrottle)))settings.gotoMaxThrottle=75;
function saveSettings(){try{localStorage.setItem("trollSettings",JSON.stringify(settings))}catch(_){}}
const SIM_GPS={lat:30.12320,lng:-83.45620};
const waypointTypes={
  waypoint:{label:"Waypoint",icon:"◆"},
  fish:{label:"Fish",icon:"🐟"},
  structure:{label:"Structure",icon:"⌁"},
  hazard:{label:"Hazard",icon:"!"},
  ramp:{label:"Ramp / Launch",icon:"▰"},
  anchor:{label:"Anchor Spot",icon:"⚓"},
  grass:{label:"Grass Flat",icon:"♒"},
  channel:{label:"Channel / Cut",icon:"⇢"},
  bait:{label:"Bait / Birds",icon:"◌"},
  dock:{label:"Dock / Pier",icon:"▥"}
};
let savedWaypoints=[];
let waypointEditId=null;
let waypointDraftType="waypoint";
let waypointDraftPhotos=[];
let waypointFilter="all";
let mapFilter="all";
let mapZoomIndex=2;
const mapZoomLevels=[2000,1000,500,250,100];
try{savedWaypoints=JSON.parse(localStorage.getItem("trollWaypoints")||"[]");if(!Array.isArray(savedWaypoints))savedWaypoints=[]}catch(_){savedWaypoints=[]}
function saveWaypointStore(){try{localStorage.setItem("trollWaypoints",JSON.stringify(savedWaypoints))}catch(e){alert("Waypoint storage is full. Remove some photos or older waypoints and try again.")}}


const state={
  speed:0, dir:0, currentHeading:287, desiredHeading:287, courseOverGround:287, steer:0, actualSteer:0, steeringFault:false,
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



function waypointCoordsText(lat=SIM_GPS.lat,lng=SIM_GPS.lng){return Number(lat).toFixed(5)+", "+Number(lng).toFixed(5)}
function waypointMapPosition(w){
  const range=mapZoomLevels[mapZoomIndex]||500;
  const latFt=(Number(w.lat)-SIM_GPS.lat)*364000;
  const lngFt=(Number(w.lng)-SIM_GPS.lng)*307000;
  const halfRange=Math.max(50,range/2);
  const left=50+(lngFt/halfRange)*44;
  const top=50-(latFt/halfRange)*44;
  return {left,top,visible:left>=4&&left<=96&&top>=5&&top<=95};
}
function savedWaypointDistance(w){
  const latFt=(Number(w.lat)-SIM_GPS.lat)*364000;
  const lngFt=(Number(w.lng)-SIM_GPS.lng)*307000;
  return Math.round(Math.hypot(latFt,lngFt));
}
function savedWaypointBearing(w){
  const dy=Number(w.lat)-SIM_GPS.lat,dx=Number(w.lng)-SIM_GPS.lng;
  if(Math.abs(dx)+Math.abs(dy)<1e-8)return state.courseOverGround||0;
  return normalize360(Math.atan2(dx,dy)*180/Math.PI);
}
function syncSavedWaypointToNav(w){
  const key="saved:"+w.id;
  wpData[key]={
    coords:waypointCoordsText(w.lat,w.lng),
    distance:savedWaypointDistance(w),
    bearing:String(Math.round(savedWaypointBearing(w))).padStart(3,"0")+"°",
    name:w.name,
    savedId:w.id,
    type:w.type,
    description:w.description||"",
    photos:w.photos||[]
  };
  return key;
}
function waypointMatchesFilter(w,filter){
  if(!filter||filter==="all")return true;
  if(filter==="other")return !["fish","structure","hazard","anchor","ramp"].includes(w.type);
  return w.type===filter;
}
function renderFilterBars(){
  const defs=[
    ["all","ALL"],["fish","🐟 FISH"],["structure","⌁ STRUCTURE"],["hazard","! HAZARDS"],
    ["anchor","⚓ ANCHORS"],["ramp","▰ RAMPS"],["grass","♒ GRASS"],["channel","⇢ CHANNEL"],
    ["bait","◌ BAIT"],["dock","▥ DOCK"],["waypoint","◆ WAYPOINTS"]
  ];
  const make=(active)=>defs.map(([id,label])=>'<button type="button" data-filter="'+id+'" class="'+(active===id?'active':'')+'">'+label+'</button>').join("");
  const w=by("waypointFilterBar"),m=by("mapFilterBar");
  if(w)w.innerHTML=make(waypointFilter);
  if(m)m.innerHTML=make(mapFilter);
}
function updateMapZoomUI(){
  const range=mapZoomLevels[mapZoomIndex]||500;
  safeText("mapZoomLabel",range>=1000?(range/1000).toFixed(range%1000?1:0)+" KFT":range+" FT");
  const map=q(".mapMock");
  if(map){
    let badge=map.querySelector(".mapRangeBadge");
    if(!badge){badge=document.createElement("div");badge.className="mapRangeBadge";map.appendChild(badge)}
    badge.textContent="VIEW "+range+" FT";
    map.classList.remove("zoomPulse");void map.offsetWidth;map.classList.add("zoomPulse");
  }
}
function renderSavedMapMarkers(){
  const map=q(".mapMock");if(!map)return;
  qa(".savedMapMarker").forEach(x=>x.remove());
  savedWaypoints.filter(w=>waypointMatchesFilter(w,mapFilter)).forEach(w=>{
    const key=syncSavedWaypointToNav(w),t=waypointTypes[w.type]||waypointTypes.waypoint,p=waypointMapPosition(w);
    if(!p.visible)return;
    const b=document.createElement("button");
    b.type="button";b.className="savedMapMarker "+w.type;b.dataset.savedId=w.id;b.dataset.wp=key;
    b.textContent=t.icon;b.title=w.name+" • "+t.label;b.style.left=p.left+"%";b.style.top=p.top+"%";
    map.appendChild(b);
  });
  updateMapZoomUI();
}
function renderWaypointList(){
  const list=by("waypointList"),empty=by("waypointEmpty");if(!list)return;
  const visible=savedWaypoints.filter(w=>waypointMatchesFilter(w,waypointFilter));
  if(empty){empty.classList.toggle("hidden",visible.length>0);const s=empty.querySelector("span");if(s&&savedWaypoints.length>0&&!visible.length)s.textContent="No saved waypoints match this filter."}
  list.innerHTML=savedWaypoints.filter(w=>waypointMatchesFilter(w,waypointFilter)).slice().reverse().map(w=>{
    const t=waypointTypes[w.type]||waypointTypes.waypoint;
    const desc=(w.description||"").replace(/[<>&]/g,m=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[m]));
    return '<article class="waypointListCard '+w.type+'" data-list-id="'+w.id+'">'+
      '<div class="wpListHead"><div><small>'+t.label.toUpperCase()+'</small><h3>'+t.icon+' '+w.name.replace(/[<>&]/g,m=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[m]))+'</h3></div><span class="wpIcon">'+t.icon+'</span></div>'+
      '<small>'+waypointCoordsText(w.lat,w.lng)+' • '+new Date(w.createdAt).toLocaleString()+'</small>'+
      (desc?'<p>'+desc.slice(0,150)+(desc.length>150?'…':'')+'</p>':'')+
      '<div class="savedMetaLine">'+
        (w.species?'<span>🐟 '+w.species+'</span>':'')+
        (w.lure?'<span>BAIT '+w.lure+'</span>':'')+
        (w.depth!==""&&w.depth!=null?'<span>'+w.depth+' ft</span>':'')+
        (w.waterTemp!==""&&w.waterTemp!=null?'<span>'+w.waterTemp+'°F</span>':'')+
        (w.tide?'<span>'+w.tide+'</span>':'')+
      '</div>'+
      '<small>'+(w.photos?.length||0)+' photo'+((w.photos?.length||0)===1?'':'s')+'</small>'+
      '<div class="waypointListActions"><button class="goSaved" data-action="goto" data-id="'+w.id+'">GO TO</button><button data-action="edit" data-id="'+w.id+'">EDIT</button><button class="deleteSaved" data-action="delete" data-id="'+w.id+'">DELETE</button></div>'+
    '</article>';
  }).join("");
}
function renderSavedWaypoints(){renderWaypointList();renderSavedMapMarkers()}
function openSavedWaypointCard(w,marker){
  const key=syncSavedWaypointToNav(w),nav=wpData[key],t=waypointTypes[w.type]||waypointTypes.waypoint;
  selectedWaypointEl=marker||q('.savedMapMarker[data-saved-id="'+w.id+'"]');
  safeText("wpName",w.name);safeText("wpCoords",nav.coords);safeText("wpDistance",nav.distance+" ft");safeText("wpBearing",nav.bearing);
  const card=by("waypointCard");if(card){
    let typeEl=card.querySelector(".waypointCardType");
    if(!typeEl){typeEl=document.createElement("div");typeEl.className="waypointCardType";card.insertBefore(typeEl,card.firstChild)}
    typeEl.textContent=t.icon+" "+t.label.toUpperCase();
    let detail=card.querySelector(".savedWaypointDetail");
    if(!detail){detail=document.createElement("div");detail.className="savedWaypointDetail";card.appendChild(detail)}
    detail.innerHTML='<div class="metaGrid">'+
      (w.species?'<span>🐟 '+w.species+'</span>':'')+
      (w.lure?'<span>BAIT '+w.lure+'</span>':'')+
      (w.depth!==""&&w.depth!=null?'<span>DEPTH '+w.depth+' ft</span>':'')+
      (w.waterTemp!==""&&w.waterTemp!=null?'<span>WATER '+w.waterTemp+'°F</span>':'')+
      (w.tide?'<span>'+w.tide+'</span>':'')+
      '</div>'+
      (w.description?'<p class="note">'+w.description.replace(/[<>&]/g,m=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[m]))+'</p>':'')+
      ((w.photos||[]).length?'<div class="waypointCardPhotos">'+w.photos.map(src=>'<img src="'+src+'" alt="">').join("")+'</div>':'');
    card.classList.remove("hidden");
  }
  const go=by("goTo");if(go){go.disabled=nav.distance>settings.gotoRadius||!autopilotAllowed();go.textContent=navigating?"NAVIGATING…":"GO TO";go.classList.toggle("navigating",navigating)}
  safeText("goNote",nav.distance>settings.gotoRadius?"Move within "+settings.gotoRadius+" ft to enable GO TO":"Available within "+settings.gotoRadius+" ft");
}
function openWaypointEditor(type,id=null){
  waypointDraftType=waypointTypes[type]?type:"waypoint";
  waypointEditId=id;
  const existing=id?savedWaypoints.find(w=>w.id===id):null;
  waypointDraftPhotos=existing?(existing.photos||[]).slice(0,5):[];
  safeText("waypointEditorType",(waypointTypes[waypointDraftType]||waypointTypes.waypoint).label.toUpperCase());
  safeText("waypointEditorTitle",existing?"EDIT WAYPOINT":"SAVE CURRENT POSITION");
  const name=by("waypointNameInput"),coords=by("waypointCoordsInput"),desc=by("waypointDescInput"),photos=by("waypointPhotosInput"),species=by("waypointSpeciesInput"),lure=by("waypointLureInput"),depth=by("waypointDepthInput"),temp=by("waypointTempInput"),tide=by("waypointTideInput");
  if(name)name.value=existing?existing.name:"";
  if(coords)coords.value=existing?waypointCoordsText(existing.lat,existing.lng):waypointCoordsText();
  if(desc)desc.value=existing?existing.description||"":"";
  if(species)species.value=existing?existing.species||"":"";
  if(lure)lure.value=existing?existing.lure||"":"";
  if(depth)depth.value=existing&&existing.depth!==undefined?existing.depth:"";
  if(temp)temp.value=existing&&existing.waterTemp!==undefined?existing.waterTemp:"";
  if(tide)tide.value=existing?existing.tide||"":"";
  const fishFields=by("fishMetaFields");if(fishFields)fishFields.classList.toggle("hidden",waypointDraftType!=="fish");
  if(photos)photos.value="";
  updateWaypointEditorCounts();renderWaypointPhotoPreview();
  const ov=by("waypointEditor");if(ov)ov.classList.remove("hidden");
  setTimeout(()=>{if(name)name.focus()},50);
}
function closeWaypointEditor(){
  const ov=by("waypointEditor");if(ov)ov.classList.add("hidden");
  waypointEditId=null;waypointDraftPhotos=[];
}
function updateWaypointEditorCounts(){
  const d=by("waypointDescInput");
  safeText("waypointDescCount",(d?d.value.length:0)+" / 500");
  safeText("waypointPhotoCount",waypointDraftPhotos.length+" / 5");
}
function renderWaypointPhotoPreview(){
  const p=by("waypointPhotoPreview");if(!p)return;
  p.innerHTML=waypointDraftPhotos.map(src=>'<img src="'+src+'" alt="Waypoint photo">').join("");
}
function fileToWaypointPhoto(file){
  return new Promise(resolve=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const max=960,scale=Math.min(1,max/Math.max(img.width,img.height));
        const c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL("image/jpeg",.72));
      };
      img.onerror=()=>resolve(null);img.src=fr.result;
    };
    fr.onerror=()=>resolve(null);fr.readAsDataURL(file);
  });
}
async function addWaypointPhotos(files){
  const remaining=5-waypointDraftPhotos.length;
  for(const f of Array.from(files).slice(0,remaining)){
    const src=await fileToWaypointPhoto(f);if(src)waypointDraftPhotos.push(src);
  }
  renderWaypointPhotoPreview();updateWaypointEditorCounts();
}
function commitWaypoint(){
  const name=(by("waypointNameInput")?.value||"").trim();
  if(!name){alert("Enter a name for this location.");return}
  const description=(by("waypointDescInput")?.value||"").trim().slice(0,500);
  const species=(by("waypointSpeciesInput")?.value||"").trim().slice(0,50);
  const lure=(by("waypointLureInput")?.value||"").trim().slice(0,80);
  const depth=(by("waypointDepthInput")?.value||"").trim();
  const waterTemp=(by("waypointTempInput")?.value||"").trim();
  const tide=(by("waypointTideInput")?.value||"").trim().slice(0,50);
  if(waypointEditId){
    const w=savedWaypoints.find(x=>x.id===waypointEditId);if(!w)return;
    w.name=name;w.description=description;w.photos=waypointDraftPhotos.slice(0,5);w.type=waypointDraftType;w.species=species;w.lure=lure;w.depth=depth;w.waterTemp=waterTemp;w.tide=tide;
  }else{
    savedWaypoints.push({id:"wp"+Date.now(),type:waypointDraftType,name,lat:SIM_GPS.lat,lng:SIM_GPS.lng,description,species,lure,depth,waterTemp,tide,photos:waypointDraftPhotos.slice(0,5),createdAt:Date.now()});
  }
  saveWaypointStore();renderSavedWaypoints();closeWaypointEditor();
}
function renderPreflightRows(){
  const list=by("preflightList");if(!list)return;
  list.innerHTML=preflightChecks.map(c=>
    '<div class="preflightRow" id="pf-'+c.id+'"><div><b>'+c.label+'</b><small>'+c.detail+(c.safety?' • SAFETY CRITICAL':' • AUTOPILOT REQUIRED')+'</small></div><span class="pfStatus">…</span></div>'
  ).join("");
}
function setPreflightRow(check,status){
  const row=by("pf-"+check.id);if(!row)return;
  row.className="preflightRow "+status;
  const s=row.querySelector(".pfStatus");
  if(s)s.textContent=status==="checking"?"…":status==="pass"?"✓":"✕";
}
function applyPreflightRestrictions(){
  const safetyFail=preflightChecks.some(c=>c.safety&&!c.pass);
  const nonSafetyFail=preflightChecks.some(c=>!c.safety&&!c.pass);
  preflightMode=safetyFail?"locked":nonSafetyFail?"manualOnly":"ready";
  preflightComplete=true;
  const result=by("preflightResult"),note=by("preflightNote"),btn=by("preflightContinue");
  if(result){
    result.className="preflightResult "+(preflightMode==="ready"?"ready":preflightMode==="manualOnly"?"manual":"locked");
    result.textContent=preflightMode==="ready"?"✓ SYSTEM READY":preflightMode==="manualOnly"?"⚠ MANUAL CONTROL ONLY":"✕ MOTOR LOCKED";
  }
  if(note){
    note.textContent=preflightMode==="ready"
      ?"All required systems passed. Manual and autopilot functions are available."
      :preflightMode==="manualOnly"
        ?"A non-safety navigation system failed. Manual steering and throttle remain available, but Spot Lock and all autopilot modes are disabled."
        :"A safety-critical system failed. Motor propulsion and steering commands are locked until the fault is corrected and pre-flight passes.";
  }
  if(btn){btn.textContent=preflightMode==="locked"?"ACKNOWLEDGE":"CONTINUE";btn.classList.remove("hidden")}
  render();
}
async function runPreflight(){
  preflightMode="checking";preflightComplete=false;
  renderPreflightRows();
  const bar=by("preflightBar"),pct=by("preflightPercent"),result=by("preflightResult"),btn=by("preflightContinue");
  if(btn)btn.classList.add("hidden");
  if(result){result.className="preflightResult";result.textContent="CHECKING SYSTEMS…"}
  for(let i=0;i<preflightChecks.length;i++){
    const c=preflightChecks[i];
    setPreflightRow(c,"checking");
    const startPct=Math.round(i/preflightChecks.length*100);
    if(bar)bar.style.width=startPct+"%";if(pct)pct.textContent=startPct+"%";
    await new Promise(r=>setTimeout(r,420));
    setPreflightRow(c,c.pass?"pass":"fail");
    const endPct=Math.round((i+1)/preflightChecks.length*100);
    if(bar)bar.style.width=endPct+"%";if(pct)pct.textContent=endPct+"%";
    await new Promise(r=>setTimeout(r,160));
  }
  applyPreflightRestrictions();
}
function motorCommandsAllowed(){
  return preflightComplete&&preflightMode!=="locked";
}
function autopilotAllowed(){
  return preflightComplete&&preflightMode==="ready";
}
function steeringErrorDegrees(){
  return Math.abs(normalize180(state.steer-state.actualSteer));
}
function clearResume(){
  if(resumeTimer){clearInterval(resumeTimer);resumeTimer=null}
  resumeSeconds=0;resumeState=null;
  const b=by("resumeAuto");if(b)b.classList.add("hidden");
}
function updateResumeButton(){
  const b=by("resumeAuto");if(!b)return;
  if(!resumeState||resumeSeconds<=0){b.classList.add("hidden");return}
  const label=resumeState.kind==="goto"?"GO TO":"SCOUT TROLL";
  b.textContent="↻ RESUME "+label+" ("+resumeSeconds+"s)";
  b.classList.remove("hidden");
}
function armResume(snapshot){
  clearResume();
  resumeState=snapshot;
  resumeSeconds=30;
  updateResumeButton();
  resumeTimer=setInterval(()=>{
    resumeSeconds--;
    if(resumeSeconds<=0){clearResume();return}
    updateResumeButton();
  },1000);
}
function triggerSteeringFault(){
  if(state.steeringFault)return;
  state.steeringFault=true;
  clearNavTimer();
  if(zigTimer){clearInterval(zigTimer);zigTimer=null}
  if(spotTimer){clearInterval(spotTimer);spotTimer=null}
  state.zigTroll=false;state.anchor=false;state.hold=false;state.cruise=false;
  state.speed=0;state.dir=0;
  navigating=false;
  activeWaypointName="";
  render();
}
setInterval(()=>{
  // Simulator motor-angle feedback follows the command. Real hardware will replace state.actualSteer.
  const diff=normalize180(state.steer-state.actualSteer);
  const step=Math.sign(diff)*Math.min(Math.abs(diff),30);
  state.actualSteer=normalize180(state.actualSteer+step);
  const err=steeringErrorDegrees();
  if(err>settings.steeringFaultTolerance){
    if(!steeringFaultSince)steeringFaultSince=Date.now();
    if(Date.now()-steeringFaultSince>=2000)triggerSteeringFault();
  }else steeringFaultSince=0;
},100);
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

  const gear=state.steeringFault?"STEERING POSITION FAULT":state.signalLost?"NO SIGNAL MANUAL ONLY":state.zigTroll?"SCOUT TROLL AUTOPILOT":state.transition?(state.transitionTarget>0?"SHIFTING TO FORWARD…":"SHIFTING TO REVERSE…"):state.dir>0?"FORWARD":state.dir<0?"REVERSE":"NEUTRAL";
  const dir=by("direction");
  if(dir){
    dir.className="direction";
    if(navigating){
      dir.classList.add("autopilotExit","navWaypointStatus");
      dir.innerHTML='<span class="navMain">AUTO NAVIGATING TO WAYPOINT</span><span class="navDistance">'+Math.max(0,Math.round(navRemaining))+' ft to location</span>';
    }else{
      dir.textContent=gear;
      if(state.signalLost)dir.classList.add("noSignal");
      else if(state.zigTroll)dir.classList.add("autopilotExit");
      else if(state.dir>0)dir.classList.add("forwardDir");
      else if(state.dir<0)dir.classList.add("reverseDir");
    }
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
    connection.textContent=!preflightComplete?"PREFLIGHT":preflightMode==="locked"?"MOTOR LOCKED":preflightMode==="manualOnly"?"MANUAL ONLY":state.steeringFault?"STEERING FAULT":state.signalLost?"NO SIGNAL":"SIMULATOR CONNECTED";
    connection.classList.toggle("noSignalStatus",state.signalLost);
  }

  const steeringLocked=!motorCommandsAllowed()||navigating||state.zigTroll||state.anchor||state.signalLost||state.steeringFault;
  const leftBtn=by("left"),rightBtn=by("right");
  if(leftBtn)leftBtn.disabled=steeringLocked;
  if(rightBtn)rightBtn.disabled=steeringLocked;
  if(helm)helm.classList.toggle("autopilotSteering",navigating||state.zigTroll);

  ["forward","reverse","speed","cruise","anchor","hold","zig"].forEach(id=>{
    const el=by(id); if(!el)return;
    const waypointLocked=navigating&&(id==="forward"||id==="reverse"||id==="speed"||id==="cruise"||id==="anchor"||id==="hold"||id==="zig");
    const zigLocked=state.zigTroll&&(id==="forward"||id==="reverse"||id==="cruise"||id==="anchor"||id==="hold");
    const spotLocked=state.anchor&&(id==="forward"||id==="reverse"||id==="speed"||id==="cruise"||id==="hold"||id==="zig");
    const preflightLocked=!motorCommandsAllowed()||(preflightMode==="manualOnly"&&(id==="cruise"||id==="anchor"||id==="hold"||id==="zig"));
    const locked=state.signalLost||state.steeringFault||preflightLocked||waypointLocked||zigLocked||spotLocked;
    el.disabled=locked;
    el.classList.toggle("motorLocked",locked);
  });
  const goBtn=by("goTo");
  if(goBtn&&(state.signalLost||!autopilotAllowed())){goBtn.disabled=true;goBtn.classList.add("motorLocked")}
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

  const mapBoat=q(".mapBoat");
  if(mapBoat)mapBoat.style.transform="rotate("+normalize360(state.courseOverGround)+"deg)";
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
  if(id==="waypointsPage"){renderFilterBars();renderWaypointList()}
  if(id==="mapPage"){renderFilterBars();renderSavedMapMarkers()}
}

function setSteer(v){
  if(!motorCommandsAllowed()||navigating||state.zigTroll||state.anchor||state.signalLost)return;
  state.steer=clampManualSteer(v);
  state.desiredHeading=normalize360(state.currentHeading+state.steer);
  render();
}

on(by("left"),"click",()=>setSteer(state.steer-settings.steerStep));
on(by("right"),"click",()=>setSteer(state.steer+settings.steerStep));

function dial(e){
  if(!motorCommandsAllowed()||navigating||state.zigTroll||state.anchor||state.signalLost||!ring||helmBoundaryLocked)return;
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
  if(!motorCommandsAllowed()||navigating||state.zigTroll||state.anchor||state.signalLost)return;
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
  if(!motorCommandsAllowed()||state.signalLost||state.transition)return;

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
  if(!motorCommandsAllowed()||state.signalLost||state.anchor)return;
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
function cancelZigTroll(allowResume=false){
  if(allowResume&&state.zigTroll){
    armResume({kind:"scout",baseHeading:zigBaseHeading,leg:zigLeg,feet:zigFeet,speed:state.speed});
  }
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
  if(!autopilotAllowed()||state.signalLost||state.steeringFault||state.zigTroll)return;
  clearResume();
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
  safeText("spotThrust",Math.round(state.anchor?state.speed:0)+"%");
  const a=by("spotAction");
  if(a){
    const d=Math.hypot(spotDx,spotDy);
    const limit=state.spotAccuracy==="high"?3:state.spotAccuracy==="medium"?6:10;
    const label=d>limit?"RECOVERING":spotCorrecting?"CORRECTING":"HOLDING";
    a.textContent=label;
    a.className=label.toLowerCase();
  }
}
function startSpotSimulation(){
  if(spotTimer)clearInterval(spotTimer);
  spotDx=1.2;spotDy=-.8;spotCorrecting=false;
  updateSpotDisplay();
  spotTimer=setInterval(()=>{
    if(!state.anchor||state.signalLost||state.steeringFault)return;
    const limit=state.spotAccuracy==="high"?3:state.spotAccuracy==="medium"?6:10;
    const maxPower=state.spotAccuracy==="high"?80:state.spotAccuracy==="medium"?55:35;
    const d=Math.hypot(spotDx,spotDy);
    if(!spotCorrecting&&d>limit)spotCorrecting=true;
    if(spotCorrecting&&d<limit*.65)spotCorrecting=false;

    // Simulated wind/current drift.
    spotDx+=(Math.random()-.5)*1.25;
    spotDy+=(Math.random()-.5)*1.25;

    if(spotCorrecting){
      const error=Math.max(0,d-limit*.55);
      const ratio=Math.max(.15,Math.min(1,error/(limit*.9)));
      state.speed=Math.round(10+(maxPower-10)*ratio);
      state.dir=1;
      const correction=(state.speed/maxPower)*1.15;
      spotDx-=(spotDx/(d||1))*correction;
      spotDy-=(spotDy/(d||1))*correction;
    }else{
      state.speed=0;state.dir=0;
    }

    // Keep simulator dot on the display without faking the selected hold radius.
    const nd=Math.hypot(spotDx,spotDy);
    if(nd>12){const f=12/nd;spotDx*=f;spotDy*=f}
    updateSpotDisplay();
    render();
  },700);
}
function startSpotLock(){
  if(!autopilotAllowed()||state.signalLost||state.steeringFault||navigating||state.zigTroll)return;
  clearResume();
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
on(by("hold"),"click",()=>{if(!autopilotAllowed()||state.signalLost||navigating||state.zigTroll)return;state.hold=!state.hold;render()});
on(by("cruise"),"click",()=>{if(!autopilotAllowed()||state.signalLost||state.zigTroll)return;state.cruise=!state.cruise;if(state.cruise)state.anchor=false;render()});
qa(".accuracyBtns button").forEach(b=>on(b,"click",()=>{state.spotAccuracy=b.dataset.accuracy||"medium";render();}));
on(by("exitSpotLock"),"click",stopSpotLock);
on(by("zig"),"click",()=>state.zigTroll?cancelZigTroll():startZigTroll());
on(by("stop"),"click",()=>{
  if(navigating)armResume({kind:"goto",waypoint:activeWaypointName,remaining:navRemaining});
  else if(state.zigTroll)armResume({kind:"scout",baseHeading:zigBaseHeading,leg:zigLeg,feet:zigFeet,speed:state.speed});
  clearNavTimer();
  if(spotTimer){clearInterval(spotTimer);spotTimer=null}
  autoSteerToken++;motionToken++;
  if(zigTimer){clearInterval(zigTimer);zigTimer=null}
  state.zigTroll=false;zigFeet=0;zigLeg="diag";
  state.speed=0;state.dir=0;state.anchor=false;state.hold=false;state.cruise=false;
  state.transition=false;state.transitionTarget=0;
  if(navigating){
    navigating=false;activeWaypointName="";
    const route=by("routeSvg");if(route)route.classList.remove("on");
    const go=by("goTo");if(go){go.textContent="GO TO";go.classList.remove("navigating")}
  }
  render();
});

const wpData={
  "Rock Pile":{coords:"30.12345, -83.45678",distance:286,bearing:"042°"},
  "Creek Mouth":{coords:"30.12402, -83.45531",distance:418,bearing:"071°"},
  "Trout Hole":{coords:"30.12271, -83.45744",distance:612,bearing:"198°"}
};
let selectedWaypointEl=null;
let navigating=false;
let activeWaypointName="";
let navTimer=null;
let navRemaining=0;
let navApproachSpeed=null;

function clearNavTimer(){
  if(navTimer){clearInterval(navTimer);navTimer=null}
}
function completeGoTo(){
  if(!navigating)return;
  clearNavTimer();
  navApproachSpeed=null;
  autoSteerToken++;
  navigating=false;
  const arrivedName=activeWaypointName;
  activeWaypointName="";
  state.speed=0;
  state.dir=0;
  const route=by("routeSvg");if(route)route.classList.remove("on");
  const go=by("goTo");if(go){go.textContent="GO TO";go.classList.remove("navigating")}
  safeText("goNote",arrivedName?"Arrived at "+arrivedName+" • Spot Lock engaged":"Arrived • Spot Lock engaged");
  page("controlPage");
  // Handoff the reached waypoint position to Spot Lock.
  state.anchor=true;
  state.hold=false;
  state.cruise=false;
  state.zigTroll=false;
  spotDx=0;spotDy=0;
  startSpotSimulation();
  render();
}
function cancelAutopilot(allowResume=false){
  if(allowResume&&navigating){
    armResume({kind:"goto",waypoint:activeWaypointName,remaining:navRemaining});
  }
  autoSteerToken++;
  clearNavTimer();
  navApproachSpeed=null;
  if(!navigating)return;
  navigating=false;
  activeWaypointName="";
  motionToken++;
  const route=by("routeSvg"); if(route)route.classList.remove("on");
  const go=by("goTo"); if(go){go.textContent="GO TO";go.classList.remove("navigating")}
  safeText("goNote","Auto pilot cancelled");
  render();
}

function engageAutopilot(remainingOverride=null){
  if(!autopilotAllowed()||state.signalLost||state.steeringFault||!selectedWaypointEl)return;
  if(remainingOverride===null)clearResume();
  if(state.zigTroll)cancelZigTroll();
  const name=selectedWaypointEl.dataset.wp;
  const w=wpData[name];
  if(!w||w.distance>settings.gotoRadius)return;
  navigating=true;
  activeWaypointName=name;
  page("controlPage");
  state.hold=false;
  state.cruise=false;
  // In the simulator, point the commanded motor direction toward the waypoint bearing.
  const targetBearing=parseFloat(w.bearing);
  if(Number.isFinite(targetBearing)){
    state.courseOverGround=normalize360(targetBearing);
    smoothAutoSteer(normalize180(targetBearing-state.currentHeading),settings.autoSteerSeconds);
  }
  const go=by("goTo"); if(go){go.textContent="NAVIGATING…";go.classList.add("navigating")}
  navRemaining=remainingOverride===null?w.distance:Math.max(3,Number(remainingOverride)||w.distance);
  navApproachSpeed=null;
  state.dir=1;
  state.speed=settings.gotoMaxThrottle;
  safeText("goNote","Navigating to waypoint • arrival will engage Spot Lock");
  clearNavTimer();
  navTimer=setInterval(()=>{
    if(!navigating||state.signalLost){clearNavTimer();return}

    // Smoothly ramp from Go-To max throttle down to low thrust near arrival.
    const slow=settings.gotoSlowdownDistance;
    if(navRemaining<=slow){
      const span=Math.max(1,slow-3);
      const progress=Math.max(0,Math.min(1,(navRemaining-3)/span));
      state.speed=Math.max(8,8+(settings.gotoMaxThrottle-8)*progress);
    }else{
      state.speed=settings.gotoMaxThrottle;
    }

    const mph=state.speed*0.048;
    const feetPerTick=Math.max(.15,mph*1.46667*.25);
    navRemaining=Math.max(0,navRemaining-feetPerTick);
    safeText("wpDistance",Math.max(0,Math.round(navRemaining))+" ft");
    safeText("goNote","Navigating to waypoint • arrival will engage Spot Lock");
    render();
    if(navRemaining<=3)completeGoTo();
  },250);
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
on(by("goTo"),"click",()=>engageAutopilot());
on(by("direction"),"click",()=>{if(state.signalLost||state.steeringFault)return;if(state.zigTroll)cancelZigTroll(true);else if(navigating)cancelAutopilot(true)});
on(by("resumeAuto"),"click",()=>{
  if(!resumeState||resumeSeconds<=0||state.signalLost||state.steeringFault)return;
  const snap={...resumeState};
  clearResume();
  if(snap.kind==="goto"){
    const wp=qa(".wp").find(x=>x.dataset.wp===snap.waypoint);
    if(!wp)return;
    selectedWaypointEl=wp;
    page("controlPage");
    engageAutopilot(snap.remaining);
  }else if(snap.kind==="scout"){
    state.anchor=false;state.hold=false;state.cruise=false;state.zigTroll=true;
    state.transition=false;state.transitionTarget=0;state.dir=1;
    state.speed=Math.max(10,Math.min(100,Number(snap.speed)||50));
    zigBaseHeading=Number(snap.baseHeading)||normalize360(state.currentHeading);
    zigLeg=snap.leg==="left"?"left":"diag";
    zigFeet=Math.max(0,Number(snap.feet)||0);
    applyZigLeg();
    if(zigTimer)clearInterval(zigTimer);
    zigTimer=setInterval(()=>{
      if(!state.zigTroll||state.signalLost||state.steeringFault)return;
      const mph=state.speed*0.048;
      zigFeet+=mph*1.46667*.1;
      const targetFeet=zigLeg==="diag"?75:50;
      if(zigFeet>=targetFeet){zigFeet=0;zigLeg=zigLeg==="diag"?"left":"diag";applyZigLeg()}
    },100);
    render();
  }
});

on(by("waypointFilterBar"),"click",e=>{
  const b=e.target.closest("button[data-filter]");if(!b)return;
  waypointFilter=b.dataset.filter||"all";renderFilterBars();renderWaypointList();
});
on(by("mapFilterBar"),"click",e=>{
  const b=e.target.closest("button[data-filter]");if(!b)return;
  mapFilter=b.dataset.filter||"all";renderFilterBars();renderSavedMapMarkers();
});
on(by("mapZoomIn"),"click",()=>{if(mapZoomIndex<mapZoomLevels.length-1){mapZoomIndex++;renderSavedMapMarkers()}});
on(by("mapZoomOut"),"click",()=>{if(mapZoomIndex>0){mapZoomIndex--;renderSavedMapMarkers()}});
on(by("mapCenterBoat"),"click",()=>{renderSavedMapMarkers()});
qa("[data-add-type]").forEach(b=>on(b,"click",()=>openWaypointEditor(b.dataset.addType)));
on(by("closeWaypointEditor"),"click",closeWaypointEditor);
on(by("cancelWaypointSave"),"click",closeWaypointEditor);
on(by("waypointDescInput"),"input",updateWaypointEditorCounts);
on(by("waypointPhotosInput"),"change",e=>addWaypointPhotos(e.target.files||[]));
on(by("saveWaypoint"),"click",commitWaypoint);
on(by("waypointEditor"),"click",e=>{if(e.target===by("waypointEditor"))closeWaypointEditor()});
on(by("waypointList"),"click",e=>{
  const b=e.target.closest("button[data-action]");if(!b)return;
  const w=savedWaypoints.find(x=>x.id===b.dataset.id);if(!w)return;
  if(b.dataset.action==="edit"){openWaypointEditor(w.type,w.id);return}
  if(b.dataset.action==="delete"){
    if(confirm('Delete "'+w.name+'"?')){savedWaypoints=savedWaypoints.filter(x=>x.id!==w.id);saveWaypointStore();renderSavedWaypoints()}
    return;
  }
  if(b.dataset.action==="goto"){
    renderSavedMapMarkers();
    const marker=q('.savedMapMarker[data-saved-id="'+w.id+'"]');
    openSavedWaypointCard(w,marker);
    selectedWaypointEl=marker;
    engageAutopilot();
  }
});
on(q(".mapMock"),"click",e=>{
  const marker=e.target.closest(".savedMapMarker");if(!marker)return;
  const w=savedWaypoints.find(x=>x.id===marker.dataset.savedId);if(w)openSavedWaypointCard(w,marker);
});
on(by("preflightContinue"),"click",()=>{
  const ov=by("preflightOverlay");if(ov)ov.classList.add("hidden");
});
on(window,"resize",()=>requestAnimationFrame(drawRoute));


async function loseSignal(){
  if(state.signalLost)return;
  const token=++motionToken;
  state.signalLost=true;
  clearResume();
  clearNavTimer();
  navApproachSpeed=null;
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
  const ts=by("throttleStep"),gr=by("gotoRadius"),gm=by("gotoMaxThrottle"),gd=by("gotoSlowdownDistance"),rs=by("reverseSeconds"),ss=by("steerStep"),sf=by("steeringFaultTolerance"),sl=by("signalLossSeconds"),as=by("autoSteerSeconds");
  if(ts)ts.value=String(settings.throttleStep);
  if(gr)gr.value=String(settings.gotoRadius);
  if(gm)gm.value=String(settings.gotoMaxThrottle);
  if(gd)gd.value=String(settings.gotoSlowdownDistance);
  if(rs)rs.value=String(settings.reverseSeconds);
  if(ss)ss.value=String(settings.steerStep);
  if(sf)sf.value=String(settings.steeringFaultTolerance);
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
on(by("gotoRadius"),"change",e=>{settings.gotoRadius=Math.max(5,Math.min(1000,Number(e.target.value)||500));e.target.value=settings.gotoRadius;saveSettings()});
on(by("gotoMaxThrottle"),"change",e=>{const v=Number(e.target.value);settings.gotoMaxThrottle=[50,75,100].includes(v)?v:75;e.target.value=settings.gotoMaxThrottle;saveSettings()});
on(by("gotoSlowdownDistance"),"change",e=>{settings.gotoSlowdownDistance=Math.max(10,Math.min(100,Number(e.target.value)||25));e.target.value=settings.gotoSlowdownDistance;saveSettings()});
on(by("reverseSeconds"),"change",e=>{settings.reverseSeconds=Math.max(2,Math.min(10,Number(e.target.value)||5));e.target.value=settings.reverseSeconds;saveSettings()});
on(by("steerStep"),"change",e=>{settings.steerStep=Math.max(5,Math.min(20,Number(e.target.value)||10));saveSettings()});
on(by("steeringFaultTolerance"),"change",e=>{settings.steeringFaultTolerance=Math.max(5,Math.min(30,Number(e.target.value)||15));e.target.value=settings.steeringFaultTolerance;saveSettings()});
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
    text:"Maximum distance from the boat at which GO TO may be started. Allowed range: 5–1,000 ft in 5 ft steps. A smaller radius keeps autonomous runs closer to the boat; a larger radius permits farther waypoint runs."
  },
  {
    match:a=>a.querySelector("#gotoMaxThrottle"),
    title:"Auto Navigate Throttle",
    text:"Sets the cruise throttle used during automatic waypoint navigation. Choices are 50%, 75%, or 100%, with 75% as the default. Use 50% for calmer conditions and battery savings, 75% for normal use, and 100% when stronger wind, current, or heavier seas require more authority. Approach slowdown still reduces power near the waypoint."
  },
  {
    match:a=>a.querySelector("#gotoSlowdownDistance"),
    title:"Go-To Slowdown Distance",
    text:"Distance from the waypoint where automatic approach slowdown begins. Allowed range: 10–100 ft in 5 ft steps. A larger value gives a longer, gentler approach; a smaller value holds cruise power closer to the waypoint."
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
    match:a=>a.querySelector("#steeringFaultTolerance"),
    title:"Steering Fault Tolerance",
    text:"Maximum allowed difference between commanded motor angle and reported motor angle. Allowed range: 5–30°. If the error remains larger than this for 2 seconds, propulsion is stopped and autonomous modes are cancelled. Smaller values detect problems sooner but require more accurate steering feedback."
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
enforceNumberRange("gotoRadius",5,1000,5,500);
enforceNumberRange("gotoSlowdownDistance",10,100,5,25);
enforceNumberRange("reverseSeconds",2,10,1,5);
enforceNumberRange("autoSteerSeconds",2,15,1,5);
enforceNumberRange("steeringFaultTolerance",5,30,1,15);
enforceNumberRange("signalLossSeconds",2,10,1,5);

syncSettingsUI();

window.addEventListener("error",e=>console.error("TROLL runtime error",e.error||e.message));
window.addEventListener("unhandledrejection",e=>console.error("TROLL promise error",e.reason));

renderFilterBars();
renderSavedWaypoints();
updateMapZoomUI();
renderPreflightRows();
render();
runPreflight();
})();
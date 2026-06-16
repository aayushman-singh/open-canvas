export const LOAD_TRANSITION_RUNTIME_SRC = String.raw`
function ocLoadTransitionFailure(load,phase,detail){
  detail.id=load&&load.id;
  detail.phase=phase;
  if(typeof console!=='undefined'&&console.error){
    console.error('[opencanvas load-transition] '+phase,detail);
  }
  ocRuntimeEvent(document,'opencanvas:load-experience-failure',detail);
  if(load&&load.failureEvent)ocRuntimeEvent(document,load.failureEvent,detail);
}
function ocLoadTransitionReady(load,detail){
  detail.id=load.id;
  ocRuntimeEvent(document,'opencanvas:load-experience-ready',detail);
}
function ocPlayLoadSequence(load,sequenceId,phase){
  if(!sequenceId)return true;
  var view=ocDesignerWindow();
  if(!view||typeof view.__opencanvasPlayMotionSequence!=='function'){
    ocLoadTransitionFailure(load,phase,{sequenceId:sequenceId,error:'motion player unavailable'});
    return false;
  }
  var played=view.__opencanvasPlayMotionSequence(sequenceId);
  if(played===false){
    ocLoadTransitionFailure(load,phase,{sequenceId:sequenceId,error:'motion sequence not found'});
    return false;
  }
  return true;
}
function ocWaitDocumentReady(){
  if(document.readyState!=='loading')return Promise.resolve();
  return new Promise(function(resolve){
    document.addEventListener('DOMContentLoaded',function(){resolve();});
  });
}
function ocWaitFontsReady(){
  if(document.fonts&&document.fonts.ready&&typeof document.fonts.ready.then==='function'){
    return document.fonts.ready.then(function(){return undefined;});
  }
  return Promise.reject(new Error('document.fonts.ready unavailable'));
}
function ocAssetNodeMatches(node,assetId){
  var suffix='/'+assetId;
  var src=node.getAttribute&&node.getAttribute('src');
  var poster=node.getAttribute&&node.getAttribute('poster');
  var rich=node.getAttribute&&node.getAttribute('data-opencanvas-rich-motion-asset-url');
  return src===suffix||poster===suffix||rich===suffix||
    (src&&src.indexOf(suffix)>=0)||(poster&&poster.indexOf(suffix)>=0)||(rich&&rich.indexOf(suffix)>=0);
}
function ocFindAssetNodes(assetId){
  var nodes=[];
  var candidates=document.querySelectorAll('[src]');
  for(var i=0;i<candidates.length;i++)if(ocAssetNodeMatches(candidates[i],assetId))nodes.push(candidates[i]);
  candidates=document.querySelectorAll('[poster]');
  for(var p=0;p<candidates.length;p++)if(ocAssetNodeMatches(candidates[p],assetId))nodes.push(candidates[p]);
  candidates=document.querySelectorAll('[data-opencanvas-rich-motion-asset-url]');
  for(var r=0;r<candidates.length;r++)if(ocAssetNodeMatches(candidates[r],assetId))nodes.push(candidates[r]);
  return nodes;
}
function ocWaitAssetReady(gate){
  var assetId=gate.assetId;
  var nodes=ocFindAssetNodes(assetId);
  if(nodes.length===0)return Promise.reject(new Error('asset node not found: '+assetId));
  return Promise.all(nodes.map(function(node){
    if(node.complete===true||node.readyState>=2)return Promise.resolve();
    return new Promise(function(resolve,reject){
      node.addEventListener('load',function(){resolve();},{once:true});
      node.addEventListener('loadeddata',function(){resolve();},{once:true});
      node.addEventListener('error',function(){reject(new Error('asset failed: '+assetId));},{once:true});
    });
  })).then(function(){return undefined;});
}
function ocWaitLoadGate(gate){
  if(!gate||!gate.type)return Promise.reject(new Error('invalid readiness gate'));
  if(gate.type==='document-ready')return ocWaitDocumentReady();
  if(gate.type==='fonts-ready')return ocWaitFontsReady();
  if(gate.type==='asset-ready'||gate.type==='media-ready')return ocWaitAssetReady(gate);
  return Promise.reject(new Error('unsupported readiness gate: '+gate.type));
}
function ocWithLoadTimeout(load,promise){
  return new Promise(function(resolve,reject){
    var done=false;
    var timer=setTimeout(function(){
      if(done)return;
      done=true;
      reject(new Error('load experience timed out after '+load.timeoutMs+'ms'));
    },load.timeoutMs);
    promise.then(function(value){
      if(done)return;
      done=true;
      clearTimeout(timer);
      resolve(value);
    }).catch(function(err){
      if(done)return;
      done=true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
function ocLoadExperienceAlreadyRan(load){
  if(load.run!=='once-per-session')return false;
  var view=ocDesignerWindow();
  if(!view||!view.sessionStorage){
    ocLoadTransitionFailure(load,'session-storage-unavailable',{});
    return true;
  }
  var key='opencanvas-load-experience:'+load.id;
  try{
    if(view.sessionStorage.getItem(key)==='1')return true;
    view.sessionStorage.setItem(key,'1');
    return false;
  }catch(err){
    ocLoadTransitionFailure(load,'session-storage-error',{error:String(err&&err.message?err.message:err)});
    return true;
  }
}
function hydrateLoadAndRouteTransitions(scope){
  var payload=ocGetDesignerPayload(scope);
  if(!payload||!payload.loadExperience)return;
  var load=payload.loadExperience;
  var view=ocDesignerWindow();
  var raw=view&&view.__opencanvasDesignerInteractionsRaw||'';
  var hydrationKey=raw+'|'+load.id;
  if(view&&view.__opencanvasLoadExperienceHydratedKey===hydrationKey)return;
  if(view)view.__opencanvasLoadExperienceHydratedKey=hydrationKey;
  if(ocLoadExperienceAlreadyRan(load))return;
  if(!ocPlayLoadSequence(load,load.introSequenceId,'intro-sequence'))return;
  var gates=load.gates||[];
  ocWithLoadTimeout(load,Promise.all(gates.map(ocWaitLoadGate))).then(function(){
    if(!ocPlayLoadSequence(load,load.exitSequenceId,'exit-sequence'))return;
    ocLoadTransitionReady(load,{gateCount:gates.length});
  }).catch(function(err){
    ocLoadTransitionFailure(load,'readiness-gate',{error:String(err&&err.message?err.message:err)});
  });
}
`;

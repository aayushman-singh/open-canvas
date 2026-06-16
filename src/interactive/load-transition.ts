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
function ocRouteTransitionFailure(route,phase,detail){
  detail.id=route&&route.id;
  detail.phase=phase;
  if(typeof console!=='undefined'&&console.error){
    console.error('[opencanvas route-transition] '+phase,detail);
  }
  ocRuntimeEvent(document,'opencanvas:route-transition-failure',detail);
  if(route&&route.failureEvent)ocRuntimeEvent(document,route.failureEvent,detail);
}
function ocRouteTransitionReady(route,detail){
  detail.id=route.id;
  ocRuntimeEvent(document,'opencanvas:route-transition-ready',detail);
}
function ocRouteError(phase,message,cause){
  var err=new Error(message);
  err.opencanvasRoutePhase=phase;
  err.opencanvasRouteCause=cause;
  return err;
}
function ocRouteReportedError(phase,message){
  var err=ocRouteError(phase,message);
  err.opencanvasRouteReported=true;
  return err;
}
function ocRouteErrorPhase(err){
  return err&&err.opencanvasRoutePhase?err.opencanvasRoutePhase:'navigation';
}
function ocRouteErrorMessage(err){
  if(err&&err.opencanvasRouteCause){
    var cause=err.opencanvasRouteCause;
    return String(cause&&cause.message?cause.message:cause);
  }
  return String(err&&err.message?err.message:err);
}
function ocRouteWait(ms){
  if(ms<=0)return Promise.resolve();
  return new Promise(function(resolve){setTimeout(resolve,ms);});
}
function ocRouteSequenceDelay(route,sequenceId,phase){
  if(!sequenceId)return 0;
  var view=ocDesignerWindow();
  if(!view||typeof view.__opencanvasPlayMotionSequence!=='function'){
    ocRouteTransitionFailure(route,phase,{sequenceId:sequenceId,error:'motion player unavailable'});
    return false;
  }
  var played=view.__opencanvasPlayMotionSequence(sequenceId);
  if(played===false){
    ocRouteTransitionFailure(route,phase,{sequenceId:sequenceId,error:'motion sequence not found or failed'});
    return false;
  }
  return typeof played==='number'&&Number.isFinite(played)&&played>0?played:0;
}
function ocRoutePublicRoot(){
  return document.querySelector('[data-opencanvas-public-root]');
}
function ocRouteUrlEligible(url){
  var path=url.pathname||'';
  if(path.indexOf('/assets/')===0)return false;
  if(path.indexOf('/fonts/')===0)return false;
  if(path.indexOf('/og/')===0)return false;
  if(path.indexOf('/__')===0)return false;
  if(path==='/sitemap.xml'||path==='/robots.txt'||path==='/favicon.ico')return false;
  return true;
}
function ocRouteUrlFromEvent(route,ev){
  if(!ev||ev.defaultPrevented)return null;
  if(ev.button!==undefined&&ev.button!==0)return null;
  if(ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.altKey)return null;
  var target=ev.target;
  if(!target||typeof target.closest!=='function')return null;
  var link=target.closest('[href]');
  if(!link)return null;
  if(link.getAttribute('download')!==null)return null;
  var targetAttr=link.getAttribute('target');
  if(targetAttr&&targetAttr!=='_self')return null;
  var href=link.getAttribute('href');
  if(!href||href.charAt(0)==='#')return null;
  var view=ocDesignerWindow();
  var loc=view&&view.location;
  var URLCtor=(view&&view.URL)||(typeof URL!=='undefined'?URL:null);
  if(!loc||!loc.href||typeof URLCtor!=='function'){
    ocRouteTransitionFailure(route,'url',{href:href,error:'location or URL constructor unavailable'});
    return false;
  }
  var url;
  var current;
  try{
    url=new URLCtor(href,loc.href);
    current=new URLCtor(loc.href);
  }catch(err){
    ocRouteTransitionFailure(route,'url',{href:href,error:String(err&&err.message?err.message:err)});
    return false;
  }
  if(url.origin!==current.origin)return null;
  if(url.pathname===current.pathname&&url.search===current.search&&url.hash)return null;
  if(url.href===current.href)return null;
  if(!ocRouteUrlEligible(url))return null;
  return url;
}
function ocParseRouteDocument(url,html){
  if(typeof html!=='string')throw ocRouteError('parse','route response body must be a string');
  var view=ocDesignerWindow();
  var Parser=(view&&view.DOMParser)||(typeof DOMParser!=='undefined'?DOMParser:null);
  if(typeof Parser!=='function')throw ocRouteError('parse','DOMParser unavailable');
  var parsed;
  try{
    parsed=new Parser().parseFromString(html,'text/html');
  }catch(err){
    throw ocRouteError('parse','DOMParser failed',err);
  }
  if(!parsed||typeof parsed.querySelector!=='function')throw ocRouteError('parse','parsed document has no querySelector');
  var root=parsed.querySelector('[data-opencanvas-public-root]');
  if(!root)throw ocRouteError('parse','fetched document missing public root for '+url.href);
  return {root:root,title:typeof parsed.title==='string'?parsed.title:''};
}
function ocFetchRouteDocument(url){
  var view=ocDesignerWindow();
  if(!view||typeof view.fetch!=='function')return Promise.reject(ocRouteError('fetch','fetch unavailable'));
  var request;
  try{
    request=view.fetch(url.href,{headers:{'X-OpenCanvas-Route-Transition':'1'}});
  }catch(err){
    return Promise.reject(ocRouteError('fetch','fetch threw before request settled',err));
  }
  return Promise.resolve(request).then(function(response){
    if(!response||response.ok!==true){
      var status=response&&response.status!==undefined?String(response.status):'unknown';
      throw ocRouteError('fetch','route fetch failed with status '+status);
    }
    if(typeof response.text!=='function')throw ocRouteError('fetch','route response has no text()');
    return response.text();
  }).then(function(html){
    return ocParseRouteDocument(url,html);
  });
}
function ocHydrateRouteRoot(root){
  var view=ocDesignerWindow();
  if(!view||typeof view.__opencanvasHydrate!=='function'){
    throw ocRouteError('hydrate','interactive runtime hydrator unavailable');
  }
  try{
    view.__opencanvasHydrate(root);
  }catch(err){
    throw ocRouteError('hydrate','interactive runtime hydration failed',err);
  }
}
function ocApplyRouteScroll(route){
  if(route.scrollRestoration==='preserve')return;
  if(route.scrollRestoration!=='top')throw ocRouteError('scroll','unsupported scroll restoration '+route.scrollRestoration);
  var view=ocDesignerWindow();
  if(!view||typeof view.scrollTo!=='function')throw ocRouteError('scroll','window.scrollTo unavailable');
  try{
    view.scrollTo(0,0);
  }catch(err){
    throw ocRouteError('scroll','scroll restoration failed',err);
  }
}
function ocApplyRouteFocus(route,root){
  if(!route.focusTarget)return;
  var target=null;
  if(route.focusTarget.type==='page')target=root.querySelector('[data-opencanvas-page]')||root;
  else if(route.focusTarget.type==='element')target=root.querySelector(ocAttrSelector('data-opencanvas-element',route.focusTarget.elementId));
  else throw ocRouteError('focus','unsupported focus target '+route.focusTarget.type);
  if(!target)throw ocRouteError('focus','focus target not found');
  if(typeof target.focus!=='function')throw ocRouteError('focus','focus target has no focus()');
  if(target.getAttribute&&target.getAttribute('tabindex')===null)target.setAttribute('tabindex','-1');
  try{
    target.focus();
  }catch(err){
    throw ocRouteError('focus','focus failed',err);
  }
}
function ocPushRouteHistory(route,url){
  var view=ocDesignerWindow();
  if(!view||!view.history||typeof view.history.pushState!=='function'){
    throw ocRouteError('history','history.pushState unavailable');
  }
  try{
    view.history.pushState({opencanvasRouteTransition:true,id:route.id},'',url.href);
  }catch(err){
    throw ocRouteError('history','history.pushState failed',err);
  }
}
function ocReplaceRouteRoot(root,nodes){
  if(typeof root.replaceChildren!=='function')throw ocRouteError('public-root','public root replaceChildren unavailable');
  root.replaceChildren.apply(root,nodes);
}
function ocApplyRouteSwap(route,url,currentRoot,parsed){
  var oldNodes=Array.prototype.slice.call(currentRoot.childNodes||[]);
  var oldTitle=document.title;
  var nextNodes=Array.prototype.slice.call(parsed.root.childNodes||[]);
  if(nextNodes.length===0)throw ocRouteError('parse','fetched public root is empty');
  ocReplaceRouteRoot(currentRoot,nextNodes);
  try{
    if(parsed.title)document.title=parsed.title;
    ocHydrateRouteRoot(currentRoot);
    ocApplyRouteScroll(route);
    ocApplyRouteFocus(route,currentRoot);
    var incomingDelay=ocRouteSequenceDelay(route,route.incomingSequenceId,'incoming-sequence');
    if(incomingDelay===false)throw ocRouteReportedError('incoming-sequence','incoming sequence failed');
    ocPushRouteHistory(route,url);
    return ocRouteWait(incomingDelay).then(function(){
      ocRouteTransitionReady(route,{url:url.href});
    });
  }catch(err){
    ocReplaceRouteRoot(currentRoot,oldNodes);
    document.title=oldTitle;
    throw err;
  }
}
function ocRunRouteTransition(route,url){
  var view=ocDesignerWindow();
  if(!view){
    ocRouteTransitionFailure(route,'window',{url:url.href,error:'window unavailable'});
    return;
  }
  if(view.__opencanvasRouteTransitionActive){
    ocRouteTransitionFailure(route,'already-active',{url:url.href});
    return;
  }
  var currentRoot=ocRoutePublicRoot();
  if(!currentRoot){
    ocRouteTransitionFailure(route,'public-root',{url:url.href,error:'current public root not found'});
    return;
  }
  view.__opencanvasRouteTransitionActive=true;
  ocFetchRouteDocument(url).then(function(parsed){
    var outgoingDelay=ocRouteSequenceDelay(route,route.outgoingSequenceId,'outgoing-sequence');
    if(outgoingDelay===false)return false;
    if(route.swapAt==='after-outgoing')return ocRouteWait(outgoingDelay).then(function(){return parsed;});
    if(route.swapAt==='with-outgoing')return parsed;
    throw ocRouteError('swap','unsupported swapAt '+route.swapAt);
  }).then(function(parsed){
    if(parsed===false)return undefined;
    return ocApplyRouteSwap(route,url,currentRoot,parsed);
  }).then(function(){
    view.__opencanvasRouteTransitionActive=false;
  }).catch(function(err){
    view.__opencanvasRouteTransitionActive=false;
    if(err&&err.opencanvasRouteReported)return;
    ocRouteTransitionFailure(route,ocRouteErrorPhase(err),{url:url.href,error:ocRouteErrorMessage(err)});
  });
}
function ocBindRouteTransition(route){
  var view=ocDesignerWindow();
  if(!view){
    ocRouteTransitionFailure(route,'window',{error:'window unavailable'});
    return;
  }
  var raw=view.__opencanvasDesignerInteractionsRaw||'';
  var hydrationKey=raw+'|'+route.id;
  if(view.__opencanvasRouteTransitionHydratedKey===hydrationKey)return;
  if(typeof view.__opencanvasRouteTransitionCleanup==='function')view.__opencanvasRouteTransitionCleanup();
  var handler=function(ev){
    var url=ocRouteUrlFromEvent(route,ev);
    if(url===null)return;
    if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
    if(url===false)return;
    ocRunRouteTransition(route,url);
  };
  document.addEventListener('click',handler);
  view.__opencanvasRouteTransitionHydratedKey=hydrationKey;
  view.__opencanvasRouteTransitionCleanup=function(){
    document.removeEventListener('click',handler);
  };
}
function hydrateLoadAndRouteTransitions(scope){
  var payload=ocGetDesignerPayload(scope);
  if(!payload)return;
  if(payload.routeTransition)ocBindRouteTransition(payload.routeTransition);
  if(!payload.loadExperience)return;
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

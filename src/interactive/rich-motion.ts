export const RICH_MOTION_RUNTIME_SRC = String.raw`
function ocRichMotionFailure(el,phase,detail){
  detail.phase=phase;
  el.setAttribute('data-opencanvas-rich-motion-failed',phase);
  if(typeof console!=='undefined'&&console.error){
    console.error('[opencanvas rich-motion] '+phase,detail);
  }
  ocRuntimeEvent(el,'opencanvas:rich-motion-failure',detail);
}
function ocRichMotionReady(el,detail){
  el.removeAttribute('data-opencanvas-rich-motion-failed');
  el.setAttribute('data-opencanvas-rich-motion-ready',detail.adapter);
  ocRuntimeEvent(el,'opencanvas:rich-motion-ready',detail);
}
function ocLottieAdapter(){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  var adapter=(view&&view.__opencanvasLottie)||(typeof globalThis!=='undefined'&&globalThis.__opencanvasLottie);
  if(adapter&&typeof adapter.loadAnimation==='function')return adapter;
  return null;
}
function ocPrefersReducedMotion(){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  return !!(view&&typeof view.matchMedia==='function'&&view.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function ocReadRichMotionDetail(el,assetId,family,source){
  return {
    assetId:assetId,
    elementId:el.getAttribute('data-opencanvas-element'),
    family:family,
    source:source,
    url:el.getAttribute('data-opencanvas-rich-motion-asset-url')
  };
}
function ocAppendPoster(el,url){
  if(typeof document.createElement!=='function')return false;
  var img=document.createElement('img');
  img.setAttribute('data-opencanvas-rich-motion-poster','');
  img.setAttribute('src',url);
  img.setAttribute('alt','');
  img.setAttribute('aria-hidden','true');
  img.style.setProperty('position','absolute');
  img.style.setProperty('inset','0');
  img.style.setProperty('width','100%');
  img.style.setProperty('height','100%');
  img.style.setProperty('object-fit','cover');
  img.style.setProperty('pointer-events','none');
  el.appendChild(img);
  return true;
}
function ocCreateLottieContainer(el){
  if(typeof document.createElement!=='function')return null;
  var container=document.createElement('div');
  container.setAttribute('data-opencanvas-lottie-container','');
  container.style.setProperty('position','absolute');
  container.style.setProperty('inset','0');
  container.style.setProperty('width','100%');
  container.style.setProperty('height','100%');
  container.style.setProperty('pointer-events','none');
  el.appendChild(container);
  return container;
}
function ocHydrateLottie(el,detail){
  var url=detail.url;
  if(!url){
    ocRichMotionFailure(el,'missing-asset-url',detail);
    return;
  }
  var adapter=ocLottieAdapter();
  if(!adapter){
    detail.adapter='lottie-web';
    ocRichMotionFailure(el,'adapter-unavailable',detail);
    return;
  }
  var reduced=ocPrefersReducedMotion();
  var reducedMode=el.getAttribute('data-opencanvas-rich-motion-reduced');
  if(reducedMode!=='poster'&&reducedMode!=='pause'&&reducedMode!=='hide'){
    ocRichMotionFailure(el,'invalid-reduced-motion',detail);
    return;
  }
  if(reduced&&reducedMode==='hide'){
    el.setAttribute('hidden','');
    ocRichMotionReady(el,{assetId:detail.assetId,family:detail.family,source:detail.source,adapter:'lottie-web',reducedMotion:'hide'});
    return;
  }
  if(reduced&&reducedMode==='poster'){
    var posterUrl=el.getAttribute('data-opencanvas-rich-motion-poster-url');
    if(!posterUrl){
      ocRichMotionFailure(el,'missing-poster-url',detail);
      return;
    }
    if(!ocAppendPoster(el,posterUrl)){
      ocRichMotionFailure(el,'poster-unavailable',detail);
      return;
    }
    ocRichMotionReady(el,{assetId:detail.assetId,elementId:detail.elementId,family:detail.family,source:detail.source,adapter:'lottie-web',reducedMotion:'poster',posterUrl:posterUrl});
    return;
  }
  var container=ocCreateLottieContainer(el);
  if(!container){
    detail.adapter='lottie-web';
    ocRichMotionFailure(el,'container-unavailable',detail);
    return;
  }
  var trigger=el.getAttribute('data-opencanvas-rich-motion-trigger');
  if(trigger!=='load'&&trigger!=='viewport-enter'){
    detail.trigger=trigger;
    ocRichMotionFailure(el,'unsupported-trigger',detail);
    return;
  }
  var loopAttr=el.getAttribute('data-opencanvas-rich-motion-loop');
  if(loopAttr!=='true'&&loopAttr!=='false'){
    ocRichMotionFailure(el,'invalid-loop',detail);
    return;
  }
  var loop=loopAttr==='true';
  var speed=parseFloat(el.getAttribute('data-opencanvas-rich-motion-speed')||'1');
  if(!Number.isFinite(speed)||speed<=0){
    ocRichMotionFailure(el,'invalid-speed',detail);
    return;
  }
  var autoplay=trigger==='load'&&!(reduced&&(reducedMode==='pause'||reducedMode==='poster'));
  var animation;
  try{
    animation=adapter.loadAnimation({
      container:container,
      renderer:'svg',
      loop:loop,
      autoplay:autoplay,
      path:url,
      rendererSettings:{preserveAspectRatio:'xMidYMid meet'}
    });
    if(animation&&typeof animation.setSpeed==='function')animation.setSpeed(speed);
  }catch(err){
    detail.adapter='lottie-web';
    detail.error=String(err&&err.message?err.message:err);
    ocRichMotionFailure(el,'load-error',detail);
    return;
  }
  if(!animation){
    detail.adapter='lottie-web';
    ocRichMotionFailure(el,'load-error',detail);
    return;
  }
  if(typeof animation.addEventListener==='function'){
    animation.addEventListener('data_failed',function(){
      ocRichMotionFailure(el,'data-failed',{assetId:detail.assetId,elementId:detail.elementId,family:detail.family,source:detail.source,adapter:'lottie-web',url:url});
    });
    animation.addEventListener('DOMLoaded',function(){
      ocRichMotionReady(el,{assetId:detail.assetId,elementId:detail.elementId,family:detail.family,source:detail.source,adapter:'lottie-web',url:url});
    });
  }else{
    ocRichMotionReady(el,{assetId:detail.assetId,elementId:detail.elementId,family:detail.family,source:detail.source,adapter:'lottie-web',url:url});
  }
  if(trigger==='viewport-enter'&&!autoplay){
    var view=document.defaultView||(typeof window!=='undefined'?window:null);
    if(!view||typeof view.IntersectionObserver!=='function'){
      if(typeof animation.destroy==='function')animation.destroy();
      ocRichMotionFailure(el,'viewport-observer-unavailable',{assetId:detail.assetId,elementId:detail.elementId,family:detail.family,source:detail.source,adapter:'lottie-web',url:url});
      return;
    }
    var observer=new view.IntersectionObserver(function(entries){
      for(var e=0;e<entries.length;e++){
        if(entries[e].isIntersecting){
          if(typeof animation.play==='function')animation.play();
          observer.disconnect();
          return;
        }
      }
    },{threshold:0.15});
    observer.observe(el);
  }
  if(reduced&&(reducedMode==='pause'||reducedMode==='poster')&&typeof animation.pause==='function'){
    animation.pause();
  }
}
function hydrateRichMotionAssets(scope){
  var scanRoot=scope||document;
  var nodes=scanRoot.querySelectorAll('[data-opencanvas-rich-motion-family]');
  for(var i=0;i<nodes.length;i++){(function(el){
    if(el.getAttribute('data-opencanvas-rich-motion-hydrated')==='true')return;
    el.setAttribute('data-opencanvas-rich-motion-hydrated','true');
    var assetId=el.getAttribute('data-opencanvas-rich-motion');
    var family=el.getAttribute('data-opencanvas-rich-motion-family');
    if(!assetId||!family)return;
    var source=el.getAttribute('data-opencanvas-rich-motion-source');
    var detail=ocReadRichMotionDetail(el,assetId,family,source);
    if(family==='vector-animation'&&detail.source==='lottie-json'){
      ocHydrateLottie(el,detail);
      return;
    }
    ocRichMotionFailure(el,'unsupported-runtime',detail);
  })(nodes[i]);}
}
`;

export const OVERLAY_RUNTIME_SRC = String.raw`
function ocOverlayRuntimeEvent(el,name,detail){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  if(view&&typeof view.CustomEvent==='function'){
    el.dispatchEvent(new view.CustomEvent(name,{detail:detail}));
  }
}
function ocOverlayPositionFailure(overlay,phase,detail){
  if(typeof console!=='undefined'&&console.error){
    console.error('[opencanvas overlay] '+phase,detail);
  }
  if(overlay){
    overlay.setAttribute('data-opencanvas-overlay-position-failed',phase);
    ocOverlayRuntimeEvent(overlay,'opencanvas:overlay-position-failure',{phase:phase,detail:detail});
  }
}
function ocFloatingAdapter(){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  var adapter=(view&&view.__opencanvasFloating)||(typeof globalThis!=='undefined'&&globalThis.__opencanvasFloating);
  if(
    adapter&&
    typeof adapter.computePosition==='function'&&
    typeof adapter.autoUpdate==='function'&&
    typeof adapter.offset==='function'&&
    typeof adapter.flip==='function'&&
    typeof adapter.shift==='function'
  )return adapter;
  return null;
}
function hydrateOverlays(scope){
  var scanRoot=scope||document;
  var overlays=scanRoot.querySelectorAll('[data-opencanvas-overlay]');
  for(var i=0;i<overlays.length;i++){(function(overlay){
    if(overlay.getAttribute('data-opencanvas-overlay-hydrated')==='true')return;
    overlay.setAttribute('data-opencanvas-overlay-hydrated','true');
    var id=overlay.getAttribute('data-opencanvas-overlay');
    var triggerType=overlay.getAttribute('data-opencanvas-overlay-trigger-type');
    var triggerElementId=overlay.getAttribute('data-opencanvas-overlay-trigger-element');
    var placement=overlay.getAttribute('data-opencanvas-overlay-placement');
    var anchorElementId=overlay.getAttribute('data-opencanvas-overlay-anchor-element');
    var anchorSide=overlay.getAttribute('data-opencanvas-overlay-anchor-side')||'bottom';
    var bodyScroll=overlay.getAttribute('data-opencanvas-overlay-body-scroll');
    var dismissEscape=overlay.getAttribute('data-opencanvas-overlay-dismiss-escape')==='true';
    var dismissBackdrop=overlay.getAttribute('data-opencanvas-overlay-dismiss-backdrop')==='true';
    var openSequenceId=overlay.getAttribute('data-opencanvas-overlay-open-sequence');
    var closeSequenceId=overlay.getAttribute('data-opencanvas-overlay-close-sequence');
    var lastTrigger=null;
    var anchoredCleanup=null;
    function panel(){return overlay.querySelector('[data-opencanvas-overlay-panel]')||overlay.querySelector('[tabindex="-1"]');}
    function setBodyLocked(locked){
      if(bodyScroll!=='lock'||!document.body||!document.body.style)return;
      document.body.style.setProperty('overflow',locked?'hidden':'');
    }
    function playSequence(sequenceId){
      var view=document.defaultView||(typeof window!=='undefined'?window:null);
      if(sequenceId&&view&&typeof view.__opencanvasPlayMotionSequence==='function'){
        view.__opencanvasPlayMotionSequence(sequenceId);
      }
    }
    function clearAnchoredPosition(){
      if(!anchoredCleanup)return;
      try{anchoredCleanup();}
      catch(err){
        if(typeof console!=='undefined'&&console.error)console.error('[opencanvas overlay] anchored cleanup failed',{overlayId:id,error:String(err&&err.message?err.message:err)});
      }
      anchoredCleanup=null;
    }
    function resolveAnchoredPositionParts(){
      if(placement!=='anchored')return null;
      if(!anchorElementId){
        ocOverlayPositionFailure(overlay,'missing-anchor-id',{overlayId:id});
        return false;
      }
      var adapter=ocFloatingAdapter();
      if(!adapter){
        ocOverlayPositionFailure(overlay,'adapter-unavailable',{overlayId:id,adapter:'floating-ui-dom'});
        return false;
      }
      var p=panel();
      var anchor=document.querySelector(ocAttrSelector('data-opencanvas-element',anchorElementId));
      if(!p||!anchor){
        ocOverlayPositionFailure(overlay,'missing-anchor-target',{overlayId:id,elementId:anchorElementId});
        return false;
      }
      return {adapter:adapter,panel:p,anchor:anchor};
    }
    function applyAnchoredPosition(parts,pos){
      parts.panel.style.setProperty('left',pos.x+'px');
      parts.panel.style.setProperty('top',pos.y+'px');
      overlay.removeAttribute('data-opencanvas-overlay-position-failed');
      overlay.setAttribute('data-opencanvas-overlay-position-adapter','floating-ui-dom');
      if(pos.placement)overlay.setAttribute('data-opencanvas-overlay-placement-resolved',pos.placement);
    }
    function computeAnchoredPosition(parts,middleware){
      return parts.adapter.computePosition(parts.anchor,parts.panel,{
        placement:anchorSide,
        strategy:'fixed',
        middleware:middleware
      }).then(function(pos){
        applyAnchoredPosition(parts,pos);
      });
    }
    function runOpenedEffects(trigger){
      lastTrigger=trigger||null;
      overlay.removeAttribute('hidden');
      overlay.setAttribute('data-opencanvas-overlay-open','true');
      setBodyLocked(true);
      playSequence(openSequenceId);
      var p=panel();
      if(p&&typeof p.focus==='function')p.focus();
    }
    function openAnchoredOverlay(trigger,parts){
      var middleware=[parts.adapter.offset(12),parts.adapter.flip(),parts.adapter.shift({padding:12})];
      function update(){
        return computeAnchoredPosition(parts,middleware).catch(function(err){
          ocOverlayPositionFailure(overlay,'position-error',{overlayId:id,elementId:anchorElementId,adapter:'floating-ui-dom',error:String(err&&err.message?err.message:err)});
          closeOverlay({skipSequence:true,skipReturnFocus:true});
        });
      }
      try{
        computeAnchoredPosition(parts,middleware).then(function(){
          clearAnchoredPosition();
          try{
            anchoredCleanup=parts.adapter.autoUpdate(parts.anchor,parts.panel,update);
          }catch(err){
            ocOverlayPositionFailure(overlay,'position-error',{overlayId:id,elementId:anchorElementId,adapter:'floating-ui-dom',error:String(err&&err.message?err.message:err)});
            return;
          }
          runOpenedEffects(trigger);
        }).catch(function(err){
          ocOverlayPositionFailure(overlay,'position-error',{overlayId:id,elementId:anchorElementId,adapter:'floating-ui-dom',error:String(err&&err.message?err.message:err)});
        });
      }catch(err){
        ocOverlayPositionFailure(overlay,'position-error',{overlayId:id,elementId:anchorElementId,adapter:'floating-ui-dom',error:String(err&&err.message?err.message:err)});
      }
    }
    function openOverlay(trigger){
      var anchoredParts=resolveAnchoredPositionParts();
      if(anchoredParts===false)return;
      if(anchoredParts){
        openAnchoredOverlay(trigger,anchoredParts);
        return;
      }
      runOpenedEffects(trigger);
    }
    function closeOverlay(options){
      options=options||{};
      clearAnchoredPosition();
      overlay.setAttribute('hidden','');
      overlay.removeAttribute('data-opencanvas-overlay-open');
      setBodyLocked(false);
      if(!options.skipSequence)playSequence(closeSequenceId);
      if(!options.skipReturnFocus&&lastTrigger&&typeof lastTrigger.focus==='function')lastTrigger.focus();
    }
    if(triggerType==='click'&&triggerElementId){
      var trigger=document.querySelector(ocAttrSelector('data-opencanvas-element',triggerElementId));
      if(!trigger){
        if(typeof console!=='undefined'&&console.error)console.error('[opencanvas overlay] missing trigger element',{overlayId:id,elementId:triggerElementId});
      }else{
        trigger.addEventListener('click',function(ev){
          if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
          openOverlay(trigger);
        });
      }
    }
    var closes=overlay.querySelectorAll('[data-opencanvas-overlay-close]');
    for(var c=0;c<closes.length;c++)closes[c].addEventListener('click',function(ev){
      if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
      closeOverlay();
    });
    var backdrop=overlay.querySelector('[data-opencanvas-overlay-backdrop]');
    if(backdrop&&dismissBackdrop)backdrop.addEventListener('click',function(){closeOverlay();});
    if(dismissEscape)document.addEventListener('keydown',function(ev){
      if(ev&&ev.key==='Escape'&&overlay.getAttribute('data-opencanvas-overlay-open')==='true')closeOverlay();
    });
  })(overlays[i]);}
}
`;

export const OVERLAY_RUNTIME_SRC = String.raw`
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
    function positionAnchored(){
      if(placement!=='anchored'||!anchorElementId)return;
      var p=panel();
      var anchor=document.querySelector(ocAttrSelector('data-opencanvas-element',anchorElementId));
      if(!p||!anchor||typeof anchor.getBoundingClientRect!=='function'){
        if(typeof console!=='undefined'&&console.error)console.error('[opencanvas overlay] anchored placement target unavailable',{overlayId:id,elementId:anchorElementId});
        return;
      }
      var rect=anchor.getBoundingClientRect();
      var gap=12;
      var top=rect.bottom+gap;
      var left=rect.left;
      if(anchorSide==='top')top=rect.top-gap;
      if(anchorSide==='left'){top=rect.top;left=rect.left-gap;}
      if(anchorSide==='right'){top=rect.top;left=rect.right+gap;}
      p.style.setProperty('top',Math.max(12,top)+'px');
      p.style.setProperty('left',Math.max(12,left)+'px');
    }
    function openOverlay(trigger){
      lastTrigger=trigger||null;
      overlay.removeAttribute('hidden');
      overlay.setAttribute('data-opencanvas-overlay-open','true');
      setBodyLocked(true);
      positionAnchored();
      playSequence(openSequenceId);
      var p=panel();
      if(p&&typeof p.focus==='function')p.focus();
    }
    function closeOverlay(){
      overlay.setAttribute('hidden','');
      overlay.removeAttribute('data-opencanvas-overlay-open');
      setBodyLocked(false);
      playSequence(closeSequenceId);
      if(lastTrigger&&typeof lastTrigger.focus==='function')lastTrigger.focus();
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

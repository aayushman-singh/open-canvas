export const DESIGNER_MOTION_RUNTIME_SRC = String.raw`
function ocAttrSelector(name,value){
  return '['+name+'="'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"]';
}
function ocRuntimeEvent(el,name,detail){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  if(view&&typeof view.CustomEvent==='function'){
    el.dispatchEvent(new view.CustomEvent(name,{detail:detail}));
  }
}
function ocMotionFailure(el,phase,detail){
  if(typeof console!=='undefined'&&console.error){
    console.error('[opencanvas motion] '+phase,detail);
  }
  if(el)ocRuntimeEvent(el,'opencanvas:motion-failure',{phase:phase,detail:detail});
}
function ocMarkMotionFailed(el,phase,detail){
  if(el)el.setAttribute('data-opencanvas-motion-failed',phase);
  ocMotionFailure(el,phase,detail);
}
function ocDesignerWindow(){
  return document.defaultView||(typeof window!=='undefined'?window:null);
}
function ocFindDesignerPayloadScript(scope){
  var scanRoot=scope||document;
  var script=scanRoot.querySelector('[data-opencanvas-designer-interactions]');
  if(!script&&scanRoot!==document)script=document.querySelector('[data-opencanvas-designer-interactions]');
  return script;
}
function ocGetDesignerPayload(scope){
  var script=ocFindDesignerPayloadScript(scope);
  if(!script)return null;
  var raw=script.textContent||'{}';
  var view=ocDesignerWindow();
  if(view&&view.__opencanvasDesignerInteractionsRaw===raw&&view.__opencanvasDesignerInteractionsPayload){
    return view.__opencanvasDesignerInteractionsPayload;
  }
  try{
    var payload=JSON.parse(raw);
    if(view){
      view.__opencanvasDesignerInteractionsRaw=raw;
      view.__opencanvasDesignerInteractionsPayload=payload;
    }
    return payload;
  }
  catch(err){
    if(typeof console!=='undefined'&&console.error)console.error('[opencanvas motion] invalid designer interaction payload',err);
    throw err;
  }
}
function ocReadDesignerPayload(scope){
  var script=ocFindDesignerPayloadScript(scope);
  if(!script)return null;
  if(script.getAttribute('data-opencanvas-designer-interactions-hydrated')==='true')return null;
  script.setAttribute('data-opencanvas-designer-interactions-hydrated','true');
  return ocGetDesignerPayload(scope);
}
function ocFormatLength(value){
  return typeof value==='number'?value+'px':String(value);
}
function ocFormatAngle(value){
  return typeof value==='number'?value+'deg':String(value);
}
function ocFormatBlur(value){
  return typeof value==='number'?'blur('+value+'px)':'blur('+String(value)+')';
}
function ocEasing(value){
  if(!value)return 'ease';
  if(value==='out-cubic')return 'cubic-bezier(.22,1,.36,1)';
  if(value==='in-cubic')return 'cubic-bezier(.32,0,.67,0)';
  if(value==='in-out-cubic')return 'cubic-bezier(.65,0,.35,1)';
  return value;
}
function ocAnimeAdapter(){
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  var adapter=(view&&view.__opencanvasAnime)||(typeof globalThis!=='undefined'&&globalThis.__opencanvasAnime);
  if(adapter&&adapter.waapi&&typeof adapter.waapi.animate==='function')return adapter;
  return null;
}
function ocMotionRange(properties,key,format){
  if(!Object.prototype.hasOwnProperty.call(properties,key))return null;
  var range=properties[key];
  return [format(range[0]),format(range[1])];
}
function ocRawMotionValue(value){
  return value;
}
function ocBuildAnimeMotionParams(step,targetCount){
  var properties=step.properties;
  var params={
    duration:step.durationMs,
    delay:function(_el,index){return (step.delayMs||0)+(step.staggerMs||0)*index;},
    ease:ocEasing(step.easing),
    composition:'replace'
  };
  var range;
  range=ocMotionRange(properties,'x',ocFormatLength);if(range)params.x=range;
  range=ocMotionRange(properties,'y',ocFormatLength);if(range)params.y=range;
  range=ocMotionRange(properties,'scale',ocRawMotionValue);if(range)params.scale=range;
  range=ocMotionRange(properties,'scaleX',ocRawMotionValue);if(range)params.scaleX=range;
  range=ocMotionRange(properties,'scaleY',ocRawMotionValue);if(range)params.scaleY=range;
  range=ocMotionRange(properties,'rotate',ocFormatAngle);if(range)params.rotate=range;
  range=ocMotionRange(properties,'opacity',ocRawMotionValue);if(range)params.opacity=range;
  range=ocMotionRange(properties,'backgroundColor',String);if(range)params.backgroundColor=range;
  range=ocMotionRange(properties,'color',String);if(range)params.color=range;
  range=ocMotionRange(properties,'clipPath',String);if(range)params.clipPath=range;
  range=ocMotionRange(properties,'strokeDashoffset',ocRawMotionValue);if(range)params.strokeDashoffset=range;
  range=ocMotionRange(properties,'filter',String);if(range)params.filter=range;
  else{range=ocMotionRange(properties,'blur',ocFormatBlur);if(range)params.filter=range;}
  if(targetCount<2)params.delay=step.delayMs||0;
  return params;
}
function ocBuildMotionFrame(properties,index){
  var frame={};
  var transforms=[];
  if(Object.prototype.hasOwnProperty.call(properties,'x'))transforms.push('translateX('+ocFormatLength(properties.x[index])+')');
  if(Object.prototype.hasOwnProperty.call(properties,'y'))transforms.push('translateY('+ocFormatLength(properties.y[index])+')');
  if(Object.prototype.hasOwnProperty.call(properties,'scale'))transforms.push('scale('+String(properties.scale[index])+')');
  if(Object.prototype.hasOwnProperty.call(properties,'scaleX'))transforms.push('scaleX('+String(properties.scaleX[index])+')');
  if(Object.prototype.hasOwnProperty.call(properties,'scaleY'))transforms.push('scaleY('+String(properties.scaleY[index])+')');
  if(Object.prototype.hasOwnProperty.call(properties,'rotate'))transforms.push('rotate('+ocFormatAngle(properties.rotate[index])+')');
  if(transforms.length>0)frame.transform=transforms.join(' ');
  if(Object.prototype.hasOwnProperty.call(properties,'opacity'))frame.opacity=String(properties.opacity[index]);
  if(Object.prototype.hasOwnProperty.call(properties,'backgroundColor'))frame.backgroundColor=String(properties.backgroundColor[index]);
  if(Object.prototype.hasOwnProperty.call(properties,'color'))frame.color=String(properties.color[index]);
  if(Object.prototype.hasOwnProperty.call(properties,'clipPath'))frame.clipPath=String(properties.clipPath[index]);
  if(Object.prototype.hasOwnProperty.call(properties,'strokeDashoffset'))frame.strokeDashoffset=String(properties.strokeDashoffset[index]);
  if(Object.prototype.hasOwnProperty.call(properties,'filter'))frame.filter=String(properties.filter[index]);
  else if(Object.prototype.hasOwnProperty.call(properties,'blur'))frame.filter=ocFormatBlur(properties.blur[index]);
  return frame;
}
function ocCssPropertyName(key){
  return key.replace(/[A-Z]/g,function(ch){return '-'+ch.toLowerCase();});
}
function ocResolveMotionTargets(target){
  if(!target||!target.type)return [];
  if(target.type==='page')return Array.prototype.slice.call(document.querySelectorAll(ocAttrSelector('data-opencanvas-page',target.pageId)));
  if(target.type==='section')return Array.prototype.slice.call(document.querySelectorAll(ocAttrSelector('data-opencanvas-section',target.sectionId)));
  if(target.type==='element'||target.type==='component-part'||target.type==='text-split')return Array.prototype.slice.call(document.querySelectorAll(ocAttrSelector('data-opencanvas-element',target.elementId)));
  if(target.type==='overlay')return Array.prototype.slice.call(document.querySelectorAll(ocAttrSelector('data-opencanvas-overlay',target.overlayId)));
  return [];
}
function ocResolveMotionTriggerElement(trigger){
  if(!trigger)return null;
  if(trigger.elementId)return document.querySelector(ocAttrSelector('data-opencanvas-element',trigger.elementId));
  if(trigger.sectionId)return document.querySelector(ocAttrSelector('data-opencanvas-section',trigger.sectionId));
  return null;
}
function ocPlayMotionSequence(sequence){
  if(!sequence||!sequence.steps)return;
  var adapter=ocAnimeAdapter();
  for(var i=0;i<sequence.steps.length;i++){
    var step=sequence.steps[i];
    var targets=ocResolveMotionTargets(step.target);
    if(targets.length===0){
      ocMotionFailure(null,'missing-target',{sequenceId:sequence.id,stepId:step.id,target:step.target});
      return;
    }
    if(!adapter){
      for(var a=0;a<targets.length;a++){
        ocMarkMotionFailed(targets[a],'adapter-unavailable',{sequenceId:sequence.id,stepId:step.id,adapter:'animejs-waapi'});
      }
      return;
    }
    try{
      adapter.waapi.animate(targets,ocBuildAnimeMotionParams(step,targets.length));
      for(var p=0;p<targets.length;p++){
        targets[p].setAttribute('data-opencanvas-motion-played',sequence.id);
        targets[p].setAttribute('data-opencanvas-motion-adapter','animejs-waapi');
      }
    }catch(err){
      for(var t=0;t<targets.length;t++){
        var el=targets[t];
        ocMarkMotionFailed(el,'adapter-error',{sequenceId:sequence.id,stepId:step.id,adapter:'animejs-waapi',error:String(err&&err.message?err.message:err)});
      }
      return;
    }
  }
}
function ocBindViewportMotionSequence(sequence){
  var anchor=ocResolveMotionTriggerElement(sequence.trigger);
  if(!anchor){
    ocMotionFailure(null,'missing-trigger-target',{sequenceId:sequence.id,trigger:sequence.trigger});
    return;
  }
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  if(!view||typeof view.IntersectionObserver!=='function'){
    ocMarkMotionFailed(anchor,'viewport-observer-unavailable',{sequenceId:sequence.id,trigger:sequence.trigger});
    return;
  }
  var observer=new view.IntersectionObserver(function(entries){
    for(var i=0;i<entries.length;i++){
      if(entries[i].isIntersecting){
        ocPlayMotionSequence(sequence);
        observer.disconnect();
        return;
      }
    }
  },{threshold:0.15});
  observer.observe(anchor);
}
function ocBindClickMotionSequence(sequence){
  var trigger=ocResolveMotionTriggerElement(sequence.trigger);
  if(!trigger){
    ocMotionFailure(null,'missing-trigger-target',{sequenceId:sequence.id,trigger:sequence.trigger});
    return;
  }
  trigger.addEventListener('click',function(){
    ocPlayMotionSequence(sequence);
  });
}
function ocBindHoverMotionSequence(sequence){
  var trigger=ocResolveMotionTriggerElement(sequence.trigger);
  if(!trigger){
    ocMotionFailure(null,'missing-trigger-target',{sequenceId:sequence.id,trigger:sequence.trigger});
    return;
  }
  trigger.addEventListener('mouseenter',function(){
    ocPlayMotionSequence(sequence);
  });
}
function ocApplyScrollScene(scene){
  if(!scene||!scene.sequence)return;
  var trigger=scene.trigger||{};
  var anchor=null;
  if(trigger.elementId)anchor=document.querySelector(ocAttrSelector('data-opencanvas-element',trigger.elementId));
  if(!anchor&&trigger.sectionId)anchor=document.querySelector(ocAttrSelector('data-opencanvas-section',trigger.sectionId));
  if(!anchor)return;
  var update=function(){
    if(typeof anchor.getBoundingClientRect!=='function'||typeof window==='undefined')return;
    var rect=anchor.getBoundingClientRect();
    var h=window.innerHeight||1;
    var progress=Math.max(0,Math.min(1,1-(rect.top/h)));
    var steps=scene.sequence.steps||[];
    for(var i=0;i<steps.length;i++){
      var step=steps[i];
      var targets=ocResolveMotionTargets(step.target);
      for(var t=0;t<targets.length;t++){
        var el=targets[t];
        var from=ocBuildMotionFrame(step.properties,0);
        var to=ocBuildMotionFrame(step.properties,1);
        for(var key in to){
          if(!Object.prototype.hasOwnProperty.call(to,key))continue;
          if(key==='opacity'){
            var a=parseFloat(from[key]);
            var b=parseFloat(to[key]);
            if(Number.isFinite(a)&&Number.isFinite(b))el.style.setProperty('opacity',String(a+(b-a)*progress));
          }else{
            el.style.setProperty(ocCssPropertyName(key),progress>=1?to[key]:from[key]);
          }
        }
      }
    }
  };
  update();
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('scroll',update,{passive:true});
}
function hydrateDesignerMotion(scope){
  var payload=ocReadDesignerPayload(scope);
  if(!payload)return;
  var sequences=payload.motionSequences||[];
  var byId={};
  for(var i=0;i<sequences.length;i++)byId[sequences[i].id]=sequences[i];
  var view=document.defaultView||(typeof window!=='undefined'?window:null);
  if(view)view.__opencanvasPlayMotionSequence=function(id){if(byId[id]){ocPlayMotionSequence(byId[id]);return true;}return false;};
  for(var s=0;s<sequences.length;s++){
    var seq=sequences[s];
    if(seq.trigger&&seq.trigger.type==='load')ocPlayMotionSequence(seq);
    else if(seq.trigger&&seq.trigger.type==='viewport-enter')ocBindViewportMotionSequence(seq);
    else if(seq.trigger&&seq.trigger.type==='click')ocBindClickMotionSequence(seq);
    else if(seq.trigger&&seq.trigger.type==='hover')ocBindHoverMotionSequence(seq);
  }
  var scenes=payload.scrollScenes||[];
  for(var j=0;j<scenes.length;j++)ocApplyScrollScene(scenes[j]);
}
`;

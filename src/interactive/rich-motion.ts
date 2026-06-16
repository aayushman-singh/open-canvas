export const RICH_MOTION_RUNTIME_SRC = String.raw`
function hydrateRichMotionAssets(scope){
  var scanRoot=scope||document;
  var nodes=scanRoot.querySelectorAll('[data-opencanvas-rich-motion-family]');
  for(var i=0;i<nodes.length;i++){(function(el){
    if(el.getAttribute('data-opencanvas-rich-motion-hydrated')==='true')return;
    el.setAttribute('data-opencanvas-rich-motion-hydrated','true');
    var assetId=el.getAttribute('data-opencanvas-rich-motion');
    var family=el.getAttribute('data-opencanvas-rich-motion-family');
    if(!assetId||!family)return;
    var detail={
      assetId:assetId,
      family:family,
      source:el.getAttribute('data-opencanvas-rich-motion-source'),
      phase:'unsupported-runtime'
    };
    el.setAttribute('data-opencanvas-rich-motion-failed','unsupported-runtime');
    if(typeof console!=='undefined'&&console.error){
      console.error('[opencanvas rich-motion] unsupported runtime adapter',detail);
    }
    ocRuntimeEvent(el,'opencanvas:rich-motion-failure',detail);
  })(nodes[i]);}
}
`;

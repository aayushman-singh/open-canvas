export const ENTRANCE_OBSERVER_SCRIPT = String.raw`
(function(){
  if(!("IntersectionObserver" in window))return;
  var els=document.querySelectorAll("[data-entrance],[data-entrance-animation][data-scroll-trigger=\"on-scroll\"]");
  if(!els.length)return;
  var io=new IntersectionObserver(function(entries){
    for(var i=0;i<entries.length;i++){
      if(entries[i].isIntersecting){
        entries[i].target.setAttribute("data-visible","");
        var pagePreset=entries[i].target.getAttribute("data-entrance-animation");
        if(pagePreset)entries[i].target.setAttribute("data-motion-preset",pagePreset);
        io.unobserve(entries[i].target);
      }
    }
  },{threshold:0.15});
  for(var j=0;j<els.length;j++)io.observe(els[j]);
})();
`;

export const ENTRANCE_ANIMATION_CSS = [
  '[data-entrance]{opacity:0;transition:opacity var(--motion-duration,0.6s) var(--motion-easing,ease),transform var(--motion-duration,0.6s) var(--motion-easing,ease);}',
  '[data-entrance][data-visible]{opacity:1;transform:none;}',
].join('\n');

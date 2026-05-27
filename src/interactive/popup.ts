// src/interactive/popup.ts
//
// Wave 4 — Popup runtime fragment. Exports a JS source string
// (`POPUP_RUNTIME_SRC`) that the snapshot-time bundler in `./build.ts`
// concatenates into the single interactive runtime IIFE.
//
// Unlike accordion/carousel which hydrate per-element roots, the popup runtime
// operates at the section level. It finds all sections marked with
// `data-rev01-popup="true"` and wires trigger logic (exit-intent, delay,
// scroll) to show them as modal overlays.
//
// Trigger types:
//   - `exit-intent`: fires when mouse leaves viewport top (mouseleave on
//     documentElement, only when clientY <= 0).
//   - `delay`: fires after N milliseconds (value from data-rev01-trigger-value).
//   - `scroll`: fires when scroll percentage >= value (0-100).
//
// Dismissal persists via localStorage so each popup shows only once per
// visitor per section.

export const POPUP_RUNTIME_SRC = String.raw`
function initPopups(){
var els=document.querySelectorAll('[data-rev01-popup="true"]');
for(var i=0;i<els.length;i++){(function(sec){
var id=sec.getAttribute('data-rev01-section');
var type=sec.getAttribute('data-rev01-trigger-type');
var val=parseInt(sec.getAttribute('data-rev01-trigger-value')||'0',10);
var key='rev01-popup-dismissed-'+id;
if(localStorage.getItem(key))return;
var originalStyle=sec.getAttribute('style');
var fired=false;
function show(){
if(fired)return;fired=true;
var bg=document.createElement('div');
bg.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5)';
var btn=document.createElement('button');
btn.setAttribute('aria-label','Close popup');
btn.style.cssText='position:fixed;top:16px;right:16px;z-index:100000;background:none;border:none;color:#fff;font-size:24px;cursor:pointer';
btn.textContent='x';
sec.style.display='block';
sec.style.position='fixed';
sec.style.top='50%';
sec.style.left='50%';
sec.style.transform='translate(-50%,-50%)';
sec.style.zIndex='99999';
sec.style.maxWidth='90vw';
sec.style.maxHeight='90vh';
sec.style.overflow='auto';
document.body.appendChild(bg);
document.body.appendChild(btn);
function close(){
localStorage.setItem(key,'1');
if(originalStyle===null){sec.removeAttribute('style');}else{sec.setAttribute('style',originalStyle);}
bg.parentNode.removeChild(bg);
btn.parentNode.removeChild(btn);
}
btn.addEventListener('click',close);
bg.addEventListener('click',close);
}
if(type==='exit-intent'){
document.documentElement.addEventListener('mouseleave',function(e){if(e.clientY<=0)show();});
}else if(type==='delay'){
setTimeout(show,val||3000);
}else if(type==='scroll'){
var thr=val||50;
window.addEventListener('scroll',function(){
// REVIEW: divide-by-zero when scrollHeight === innerHeight (page exactly fits viewport). Result is Infinity, so `pct >= thr` is always false and the scroll trigger never fires. Guard: `if (scrollHeight <= innerHeight) return;`.
var pct=window.scrollY/(document.documentElement.scrollHeight-window.innerHeight)*100;
if(pct>=thr)show();
});
}
})(els[i]);}
}
initPopups();
`;

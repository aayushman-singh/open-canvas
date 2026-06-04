// src/ui/opencanvas-modal-script.ts
//
// Inline IIFE that registers `window.__opencanvasModal` — the tiny
// alert/confirm/prompt modal helper used by both dashboard surfaces
// (entries delete, site-settings, themes, version-timeline, domains, etc.)
// AND the canvas editor surface (the notifications inbox's "Mark all read"
// confirm, plus any future editor-side confirm flow).
//
// Why shared:
//   - Before this module existed, the IIFE lived inline in
//     `src/routes/dashboard/shell.tsx` only. The editor route imported
//     `notificationsInboxScript` from `src/notifications/dashboard-inbox-script.ts`
//     but never registered `window.__opencanvasModal`, so the inbox's
//     `confirmStylized()` fell straight through to a rejected promise
//     ("notification confirm modal is unavailable") and "Mark all read"
//     silently failed on every `/dashboard/sites/:id/edit` page.
//   - Per CLAUDE.md no-fallback rule: NOT routing through `window.confirm`
//     as a graceful-degradation. Both surfaces register the SAME stylized
//     modal so the inbox can rely on it.
//
// CSS:
//   - The dashboard shell ships `.opencanvas-modal-*` classes inside its
//     own <style> block (shell.tsx ~line 166).
//   - The editor surface ships the same classes via
//     `src/editor-client/styles.css` (~line 3702).
//   - This module only ships the JS; both surfaces already carry the CSS.
//
// API:
//   window.__opencanvasModal = {
//     alert(message, title?)        → Promise<void>
//     confirm(message, opts?)       → Promise<boolean>
//                                     opts: { title?, confirmLabel?, danger? }
//     prompt(message, default?, title?) → Promise<string | null>
//   }
//
// Mounted as `<script>{raw(opencanvasModalScript)}</script>` at the body
// end on both shells, BEFORE the notifications IIFE so the inbox sees the
// registration immediately on first dispatch.

export const opencanvasModalScript = `(function(){
  function _build(o){return new Promise(function(resolve){
    var bd=document.createElement('div');bd.className='opencanvas-modal-backdrop';
    var m=document.createElement('div');m.className='opencanvas-modal';
    m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    if(o.title){var h=document.createElement('h3');h.textContent=o.title;m.appendChild(h);}
    if(o.message){var p=document.createElement('p');p.textContent=o.message;m.appendChild(p);}
    var inp=null;
    if(o.type==='prompt'){inp=document.createElement('input');inp.type='text';inp.value=o.defaultValue||'';m.appendChild(inp);}
    var acts=document.createElement('div');acts.className='opencanvas-modal-actions';
    var cancelBtn=null;
    if(o.type!=='alert'){cancelBtn=document.createElement('button');cancelBtn.type='button';cancelBtn.className='opencanvas-modal-cancel';cancelBtn.textContent='Cancel';acts.appendChild(cancelBtn);}
    var ok=document.createElement('button');ok.type='button';
    ok.className=o.danger?'opencanvas-modal-danger':'opencanvas-modal-ok';
    ok.textContent=o.confirmLabel||'OK';acts.appendChild(ok);m.appendChild(acts);bd.appendChild(m);
    function close(v){document.removeEventListener('keydown',onKey,true);if(bd.parentNode)bd.parentNode.removeChild(bd);resolve(v);}
    function onKey(e){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(o.type==='confirm'?false:null);return;}
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(o.type==='prompt')close(inp.value);else if(o.type==='confirm')close(true);else close(undefined);}
    }
    bd.addEventListener('click',function(e){if(e.target===bd)close(o.type==='confirm'?false:null);});
    if(cancelBtn)cancelBtn.addEventListener('click',function(){close(o.type==='confirm'?false:null);});
    ok.addEventListener('click',function(){if(o.type==='prompt')close(inp.value);else if(o.type==='confirm')close(true);else close(undefined);});
    document.addEventListener('keydown',onKey,true);document.body.appendChild(bd);
    if(inp){inp.focus();inp.select();}else{ok.focus();}
  });}
  window.__opencanvasModal={
    alert:function(msg,title){return _build({type:'alert',message:msg,title:title||''});},
    confirm:function(msg,opts){var o=opts||{};return _build({type:'confirm',message:msg,title:o.title||'',confirmLabel:o.confirmLabel,danger:o.danger});},
    prompt:function(msg,def,title){return _build({type:'prompt',message:msg,defaultValue:def||'',title:title||''});}
  };
})();`;

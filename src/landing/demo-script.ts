// src/landing/demo-script.ts
//
// Client-side script for the landing-page Open Canvas live demo.
//
// Drives the multiplayer-editing vignette inside the demo browser frame
// (see HeroPanel.tsx for the DOM, design-references/demo.js for the
// reference behaviour). The conversation in the assistant panel is
// pre-rendered server-side so the panel always reads full; the canvas
// loops:
//   reset → Sam selects the button → assistant recolors it → You drop
//   a delivery badge → publish toast → reset.
//
// Also wires the scroll-reveal IntersectionObserver used by `.proof`,
// `.features`, `.templates`, and `.cta`.
//
// Exported as a string constant — inlined into a <script> by index.tsx.
// Same pattern as src/interactive/runtime.ts.
//
// IMPORTANT: No backticks in the body — they would close the
// String.raw delimiter. Stick to single/double quotes and escape
// where needed.
export const LANDING_DEMO_SRC = String.raw`(function () {
  // ---- live multiplayer demo ----------------------------------
  var canvas   = document.getElementById('canvas');
  var artboard = document.getElementById('artboard');
  var abBtn    = document.getElementById('abBtn');
  var selRing  = document.getElementById('selRing');
  var newBadge = document.getElementById('newBadge');
  var curSam   = document.getElementById('curSam');
  var curYou   = document.getElementById('curYou');
  var toast    = document.getElementById('toast');
  var asTypeWrap = document.getElementById('asType');
  var asType   = asTypeWrap ? asTypeWrap.querySelector('.typed') : null;

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var alive = true;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function rel(el) {
    var c = canvas.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }

  function move(cur, x, y) {
    cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  function ringAround(el, pad) {
    pad = pad || 6;
    var p = rel(el);
    selRing.style.left = (p.x - pad) + 'px';
    selRing.style.top = (p.y - pad) + 'px';
    selRing.style.width = (p.w + pad * 2) + 'px';
    selRing.style.height = (p.h + pad * 2) + 'px';
  }

  if (asType && asTypeWrap) {
    // Hint text inside the assistant input box. “ / ” are
    // curly quotes (avoiding raw " inside the String.raw template).
    asType.textContent = 'Try: “add a contact form”';
  }

  async function runDemo() {
    while (alive) {
      // reset
      abBtn.classList.remove('brandified');
      newBadge.style.opacity = '0';
      newBadge.style.transform = 'scale(.8)';
      toast.classList.remove('show');
      selRing.style.opacity = '0';
      move(curSam, 50, 330);
      move(curYou, 380, 60);
      await sleep(1100);

      // Sam selects the button
      var pb = rel(abBtn);
      move(curSam, pb.x + pb.w - 12, pb.y + 6);
      await sleep(1150);
      ringAround(abBtn);
      selRing.style.opacity = '1';
      await sleep(900);

      // assistant applies — accept pulse + recolor
      var acc = document.querySelector('#opCard .acc');
      if (acc) {
        acc.style.transform = 'scale(.9)';
        setTimeout(function () { acc.style.transform = ''; }, 200);
      }
      await sleep(250);
      abBtn.classList.add('brandified');
      await sleep(1100);
      selRing.style.opacity = '0';

      // You drop a delivery badge
      var b = rel(artboard);
      var bx = b.x + b.w - 104;
      var by = b.y + 14;
      move(curYou, bx + 22, by + 12);
      await sleep(1150);
      newBadge.style.left = bx + 'px';
      newBadge.style.top = by + 'px';
      newBadge.style.opacity = '1';
      newBadge.style.transform = 'scale(1)';
      move(curYou, bx + 60, by + 70);
      await sleep(1200);

      // Publish
      toast.classList.add('show');
      await sleep(2600);
      toast.classList.remove('show');
      await sleep(900);
    }
  }

  function paintReducedMotionFinalState() {
    // prefers-reduced-motion: render the demo in its final state
    // statically — no looping, no transitions, no cursor sweeps.
    // README §32 interactions.
    abBtn.classList.add('brandified');
    var b = rel(artboard);
    newBadge.style.left = (b.x + b.w - 104) + 'px';
    newBadge.style.top = (b.y + 14) + 'px';
    newBadge.style.opacity = '1';
    newBadge.style.transform = 'scale(1)';
  }

  function startDemo() {
    if (!canvas || !artboard || !abBtn || !selRing || !newBadge || !curSam || !curYou || !toast) {
      return;
    }
    if (reduce) {
      paintReducedMotionFinalState();
      return;
    }
    setTimeout(runDemo, 500);
  }

  // ---- scroll-reveal ------------------------------------------
  function initScrollReveal() {
    var items = document.querySelectorAll('.scroll-reveal');
    if (!items.length) return;
    if (reduce || !window.IntersectionObserver) {
      for (var i = 0; i < items.length; i++) items[i].classList.add('revealed');
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('revealed');
          obs.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.15 });
    for (var j = 0; j < items.length; j++) obs.observe(items[j]);
  }

  function init() {
    initScrollReveal();
    startDemo();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();`;

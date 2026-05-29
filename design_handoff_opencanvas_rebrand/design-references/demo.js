/* Open Canvas — landing hero live demo
   Multiplayer-editing vignette. Conversation is pre-shown so the panel
   always reads full; the canvas changes loop: Sam selects → assistant
   recolors the button → You drop a badge → Publish → reset. */
(function () {
  var canvas   = document.getElementById('canvas');
  var artboard = document.getElementById('artboard');
  var abBtn    = document.getElementById('abBtn');
  var selRing  = document.getElementById('selRing');
  var newBadge = document.getElementById('newBadge');
  var curSam   = document.getElementById('curSam');
  var curYou   = document.getElementById('curYou');
  var toast    = document.getElementById('toast');
  var asType   = document.querySelector('#asType .typed');
  var prompt   = document.getElementById('asType');
  var m1 = document.getElementById('m1'), m2 = document.getElementById('m2'),
      opCard = document.getElementById('opCard'), m3 = document.getElementById('m3');
  if (!canvas) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var alive = true;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function rel(el) {
    var c = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }
  function move(cur, x, y) { cur.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  function ringAround(el, pad) {
    pad = pad || 6; var p = rel(el);
    selRing.style.left = (p.x - pad) + 'px'; selRing.style.top = (p.y - pad) + 'px';
    selRing.style.width = (p.w + pad * 2) + 'px'; selRing.style.height = (p.h + pad * 2) + 'px';
  }

  if (asType) asType.textContent = 'Try: “add a contact form”';

  async function run() {
    while (alive) {
      // reset
      abBtn.classList.remove('brandified');
      newBadge.style.opacity = '0'; newBadge.style.transform = 'scale(.8)';
      toast.classList.remove('show');
      selRing.style.opacity = '0';
      move(curSam, 50, 330); move(curYou, 380, 60);
      await sleep(1100);

      // Sam selects the button
      var pb = rel(abBtn);
      move(curSam, pb.x + pb.w - 12, pb.y + 6);
      await sleep(1150);
      ringAround(abBtn); selRing.style.opacity = '1';
      await sleep(900);

      // assistant applies — accept pulse + recolor
      var acc = opCard.querySelector('.acc');
      if (acc) { acc.style.transform = 'scale(.9)'; setTimeout(function () { acc.style.transform = ''; }, 200); }
      await sleep(250);
      abBtn.classList.add('brandified');
      await sleep(1100);
      selRing.style.opacity = '0';

      // You drop a delivery badge
      var b = rel(artboard);
      var bx = b.x + b.w - 104, by = b.y + 14;
      move(curYou, bx + 22, by + 12);
      await sleep(1150);
      newBadge.style.left = bx + 'px'; newBadge.style.top = by + 'px';
      newBadge.style.opacity = '1'; newBadge.style.transform = 'scale(1)';
      move(curYou, bx + 60, by + 70);
      await sleep(1200);

      // Publish
      toast.classList.add('show');
      await sleep(2600);
      toast.classList.remove('show');
      await sleep(900);
    }
  }

  function start() {
    if (reduce) {
      abBtn.classList.add('brandified');
      var b = rel(artboard);
      newBadge.style.left = (b.x + b.w - 104) + 'px'; newBadge.style.top = (b.y + 14) + 'px';
      newBadge.style.opacity = '1'; newBadge.style.transform = 'scale(1)';
      return;
    }
    setTimeout(run, 500);
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();

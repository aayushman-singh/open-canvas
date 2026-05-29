/* Open Canvas — editor prototype interactions */
(function () {
  var $ = function (s) { return document.querySelector(s); };

  // theme
  $('#themeToggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('oc-theme', cur); } catch (e) {}
    setTimeout(positionSel, 60);
  });

  // left tabs
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var t = b.getAttribute('data-tab');
      document.querySelectorAll('[data-tabpane]').forEach(function (p) {
        p.hidden = p.getAttribute('data-tabpane') !== t;
      });
    });
  });

  // style kit pick
  document.querySelectorAll('.kits .kit').forEach(function (k) {
    k.addEventListener('click', function () {
      document.querySelectorAll('.kits .kit').forEach(function (x) { x.classList.remove('on'); });
      k.classList.add('on');
    });
  });

  // canvas selection box over the button
  var artboard = $('#artboard'), abBtn = $('#abBtn'), selbox = $('#selbox');
  var zoom = 90;
  function positionSel() {
    var a = artboard.getBoundingClientRect(), b = abBtn.getBoundingClientRect();
    var s = zoom / 100, pad = 5;
    selbox.style.left = ((b.left - a.left) / s - pad) + 'px';
    selbox.style.top = ((b.top - a.top) / s - pad) + 'px';
    selbox.style.width = (b.width / s + pad * 2) + 'px';
    selbox.style.height = (b.height / s + pad * 2) + 'px';
  }

  // inspector → live updates
  $('#labelInput').addEventListener('input', function () {
    abBtn.textContent = this.value || 'Button';
    setTimeout(positionSel, 10);
  });

  document.querySelectorAll('#variants .v').forEach(function (v) {
    v.addEventListener('click', function () {
      document.querySelectorAll('#variants .v').forEach(function (x) { x.classList.remove('on'); });
      v.classList.add('on');
      var kind = v.getAttribute('data-var');
      var c = currentFill;
      abBtn.style.boxShadow = '';
      if (kind === 'solid') { abBtn.style.background = c; abBtn.style.color = '#fff'; abBtn.style.boxShadow = 'var(--shadow-red)'; }
      else if (kind === 'outline') { abBtn.style.background = 'transparent'; abBtn.style.color = 'var(--ink)'; abBtn.style.boxShadow = 'inset 0 0 0 2px var(--ink)'; }
      else if (kind === 'ghost') { abBtn.style.background = 'var(--surface-2)'; abBtn.style.color = 'var(--ink)'; }
      else if (kind === 'pill') { abBtn.style.background = 'var(--ink)'; abBtn.style.color = 'var(--paper)'; }
      setTimeout(positionSel, 10);
    });
  });

  var currentFill = '#E84D4A';
  document.querySelectorAll('#fills .c').forEach(function (c) {
    c.addEventListener('click', function () {
      document.querySelectorAll('#fills .c').forEach(function (x) { x.classList.remove('on'); });
      c.classList.add('on');
      currentFill = c.getAttribute('data-c');
      var active = document.querySelector('#variants .v.on').getAttribute('data-var');
      if (active === 'solid') { abBtn.style.background = currentFill; abBtn.style.color = '#fff'; }
      else if (active === 'outline') { abBtn.style.boxShadow = 'inset 0 0 0 2px ' + currentFill; abBtn.style.color = currentFill; }
    });
  });

  var radius = $('#radius'), radVal = $('#radVal');
  radius.addEventListener('input', function () {
    var v = +this.value;
    abBtn.style.borderRadius = (v / 100 * 26) + 'px';
    radVal.textContent = v >= 96 ? 'Full' : v <= 4 ? 'Square' : Math.round(v / 100 * 26) + 'px';
    setTimeout(positionSel, 10);
  });

  document.querySelectorAll('.seg2').forEach(function (seg) {
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
    });
  });

  // zoom
  var zPct = $('#zPct'), ab = $('#artboard'), stage = $('#cstage');
  function applyZoom() { zPct.textContent = Math.round(zoom) + '%'; ab.style.transform = 'translateX(-50%) scale(' + (zoom / 100) + ')'; ab.style.transformOrigin = 'top center'; setTimeout(positionSel, 30); }
  function fit() {
    // reset scale to measure natural size
    ab.style.transform = 'translateX(-50%) scale(1)';
    var aw = ab.offsetWidth, ah = ab.offsetHeight;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var z = Math.min((sw - 56) / aw, (sh - 80) / ah, 1) * 100;
    zoom = Math.max(30, Math.round(z));
    applyZoom();
  }
  $('#zIn').addEventListener('click', function () { zoom = Math.min(200, zoom + 10); applyZoom(); });
  $('#zOut').addEventListener('click', function () { zoom = Math.max(25, zoom - 10); applyZoom(); });
  var fitBtn = document.querySelector('.zoom button[title="Fit"]');
  if (fitBtn) fitBtn.addEventListener('click', fit);

  // AI panel
  var aiPanel = $('#aiPanel');
  $('#aiBtn').addEventListener('click', function () { aiPanel.classList.toggle('open'); });
  $('#aiClose').addEventListener('click', function () { aiPanel.classList.remove('open'); });
  var aiInput = $('#aiInput'), aiFeed = $('#aiFeed');
  function sendAI() {
    var v = aiInput.value.trim(); if (!v) return;
    var m = document.createElement('div'); m.className = 'ai-msg user'; m.textContent = v; aiFeed.appendChild(m);
    aiInput.value = '';
    setTimeout(function () {
      var r = document.createElement('div'); r.className = 'ai-msg bot';
      r.textContent = 'On it — preparing a preview of that change for you to approve.';
      aiFeed.appendChild(r); aiFeed.scrollTop = aiFeed.scrollHeight;
    }, 500);
    aiFeed.scrollTop = aiFeed.scrollHeight;
  }
  $('.ai-input .send').addEventListener('click', sendAI);
  aiInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendAI(); });
  document.querySelectorAll('.ai-op .acc').forEach(function (b) {
    b.addEventListener('click', function () {
      $('.ab-h').style.fontSize = '42px';
      b.closest('.ai-op').style.opacity = '.5';
      var d = document.createElement('div'); d.className = 'ai-msg bot'; d.textContent = 'Done! The headline is bigger and warmer now. ✨';
      aiFeed.appendChild(d); aiFeed.scrollTop = aiFeed.scrollHeight;
      setTimeout(positionSel, 60);
    });
  });

  // publish
  var toast = $('#toast');
  $('#publishBtn').addEventListener('click', function () {
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 2600);
  });

  // gentle peer cursor drift
  var peer = $('#peer'), px = 140, py = 120, t = 0;
  function drift() {
    t += 0.02;
    peer.style.left = (px + Math.sin(t) * 40) + 'px';
    peer.style.top = (py + Math.cos(t * 0.8) * 28) + 'px';
    requestAnimationFrame(drift);
  }

  function init() {
    fit();
    if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) drift();
    window.addEventListener('resize', function () { fit(); });
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();

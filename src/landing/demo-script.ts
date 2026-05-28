// src/landing/demo-script.ts
//
// Client-side script for the landing page demo. Drives:
//   - the miniature canvas in the hero preview panel,
//   - the editor sidebar (component button flashes, kit toggles, upload UI),
//   - the synced agent log feed,
//   - scroll-reveal animations,
//   - stat-line count-up.
//
// Exported as a string constant — inlined into a <script> by index.tsx.
// Same pattern as src/interactive/runtime.ts.
//
// IMPORTANT: No backticks in the body — they close the String.raw delimiter.

export const LANDING_DEMO_SRC = String.raw`(function() {
  var ELS = [
    ['nav',       'demo-nav-bar',     'top:0;left:0;right:0;height:7.5%;',                                          ''],
    ['logo',      'demo-text-heading', 'top:1.5%;left:4%;font-size:9px;font-weight:700;letter-spacing:-0.02em;',     'rev01'],
    ['nav-lnk',   'demo-btn-ghost',   'top:1.8%;right:22%;font-size:7px;padding:2px 6px;',                          'Features'],
    ['nav-cta',   'demo-btn-solid',   'top:1.2%;right:3%;font-size:7px;padding:3px 8px;',                           'Get started'],
    ['hero-bg',   'demo-card',        'top:10%;left:3%;width:94%;height:44%;',                                       ''],
    ['hero-h',    'demo-text-heading', 'top:16%;left:6%;width:55%;font-size:14px;font-weight:700;line-height:1.2;letter-spacing:-0.02em;white-space:normal;', ''],
    ['hero-p',    'demo-text-body',   'top:33%;left:6%;width:48%;font-size:7.5px;line-height:1.45;white-space:normal;', 'Position elements freely on a canvas. Pick a style kit. Publish.'],
    ['hero-btn',  'demo-btn-solid',   'top:43%;left:6%;font-size:7.5px;padding:4px 12px;',                          'Start editing'],
    ['hero-media','demo-media',       'top:13%;right:14%;width:22%;height:34%;border-radius:6px;',                  ''],
    ['hero-orb',  'demo-shape-circle','top:11%;right:7%;width:28px;height:28px;',                                    ''],
    ['f1',        'demo-card',        'top:57%;left:3%;width:29%;height:18%;',                                       ''],
    ['f1-dot',    'demo-shape-circle','top:60%;left:5.5%;width:8px;height:8px;',                                     ''],
    ['f1-txt',    'demo-text-body',   'top:66%;left:5%;width:25%;font-size:6.5px;line-height:1.3;',                  'Canvas primitives'],
    ['f2',        'demo-card',        'top:57%;left:35%;width:29%;height:18%;',                                      ''],
    ['f2-dot',    'demo-shape-circle','top:60%;left:37%;width:8px;height:8px;',                                      ''],
    ['f2-txt',    'demo-text-body',   'top:66%;left:37%;width:25%;font-size:6.5px;line-height:1.3;',                 'Style Kit system'],
    ['f3',        'demo-card',        'top:57%;left:67%;width:29%;height:18%;',                                      ''],
    ['f3-dot',    'demo-shape-circle','top:60%;left:69%;width:8px;height:8px;',                                      ''],
    ['f3-txt',    'demo-text-body',   'top:66%;left:69%;width:25%;font-size:6.5px;line-height:1.3;',                 'AI agent edits'],
    ['cta-h',     'demo-text-heading','top:80%;left:10%;width:80%;font-size:10px;font-weight:700;text-align:center;', 'Publish when it feels right.'],
    ['cta-b1',    'demo-btn-pill',    'top:89%;left:28%;font-size:6.5px;padding:3px 10px;',                          'Open editor'],
    ['cta-b2',    'demo-btn-outline', 'top:89%;left:54%;font-size:6.5px;padding:3px 10px;',                          'Learn more']
  ];

  // [time, action, target, log_op, log_ref, sidebar_cmp, john_pos, agent_pos]
  // sidebar_cmp = data-cmp value to flash in the sidebar Components grid
  //   For 'kit' steps it is the kit data-kit value to toggle active.
  // john_pos / agent_pos = "X% Y%" strings, positioning each cursor inside
  //   the canvas. Falsy → cursor stays at previous target.
  var STEPS = [
    [250,   'show',   'nav',                                          '+section', 'nav',                  'nav',                  '85% 4%',  '12% 4%'],
    [450,   'show',   'logo',                                         '+text',    '"rev01"',              'text',                 '85% 4%',  '6% 4%'],
    [700,   'show',   'nav-lnk',                                      '+action',  '"Features" ghost',     'button',               '74% 4%',  '6% 4%'],
    [950,   'show',   'nav-cta',                                      '+action',  '"Get started" solid',  'button',               '90% 4%',  '6% 4%'],
    [1400,  'show',   'hero-bg',                                      '+section', 'hero',                 'container',            '50% 30%', '20% 24%'],
    [1750,  'type',   'hero-h|Ship a site that feels lived-in.',      '+heading', '"Ship a site..."',     'text',                 '55% 30%', '25% 20%'],
    [3050,  'show',   'hero-p',                                       '+text',    'body paragraph',       'text',                 '55% 30%', '32% 36%'],
    [3400,  'show',   'hero-btn',                                     '+action',  '"Start editing"',      'button',               '15% 47%', '32% 36%'],
    [3750,  'upload', 'hero.jpg|500',                                  '+media',   'uploading hero.jpg',   'image',                '78% 28%', '32% 36%'],
    [4150,  'show',   'hero-media',                                   null,       null,                   null,                   '78% 28%', null],
    [4400,  'show',   'hero-orb',                                     '+shape',   'circle',               'shape',                '88% 16%', '32% 36%'],
    [4800,  'show',   'f1,f1-dot,f1-txt',                             '+section', 'features',             'container',            '18% 66%', '60% 30%'],
    [5050,  'show',   'f2,f2-dot,f2-txt',                             '+container', 'card x2',            'container',            '50% 66%', '60% 30%'],
    [5300,  'show',   'f3,f3-dot,f3-txt',                             '+container', 'card x3',            'container',            '82% 66%', '60% 30%'],
    [5700,  'show',   'cta-h',                                        '+heading', '"Publish when..."',    'text',                 '50% 84%', '46% 80%'],
    [6000,  'show',   'cta-b1',                                       '+action',  '"Open editor" pill',   'button',               '38% 92%', '46% 80%'],
    [6250,  'show',   'cta-b2',                                       null,       null,                   'button',               '64% 92%', '46% 80%'],
    [7600,  'kit',    'orange-editorial',                              'setTheme', 'orange-editorial',     'orange-editorial',     '12% 50%', '88% 70%'],
    [9000,  'kit',    'blue-saas',                                     'setTheme', 'blue-saas',            'blue-saas',            '88% 50%', '12% 70%'],
    [10400, 'kit',    'green-organic',                                 'setTheme', 'green-organic',        'green-organic',        '12% 30%', '88% 30%'],
    [11800, 'hide',   '',                                              null,       null,                   null,                   '50% 50%', '50% 50%']
  ];

  var CYCLE = 13000;
  var canvas, feed, sidebar, uploadBox, johnCur, agentCur, els = {}, timers = [];

  function show(id) { if (els[id]) els[id].classList.add('in'); }

  function hideAll() {
    var keys = Object.keys(els);
    for (var i = 0; i < keys.length; i++) els[keys[i]].classList.remove('in');
  }

  function setKit(k) { canvas.setAttribute('data-kit', k); }

  function flashCmp(name) {
    if (!sidebar || !name) return;
    var btn = sidebar.querySelector('[data-cmp="' + name + '"]');
    if (!btn) return;
    btn.classList.add('clicked');
    timers.push(setTimeout(function() { btn.classList.remove('clicked'); }, 650));
  }

  function activateKit(name) {
    if (!sidebar) return;
    var btns = sidebar.querySelectorAll('[data-kit]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.getAttribute('data-kit') === name) {
        b.classList.add('clicked');
        b.classList.add('active');
        timers.push(setTimeout((function(node) {
          return function() { node.classList.remove('clicked'); };
        })(b), 650));
      } else {
        b.classList.remove('active');
      }
    }
  }

  function moveCursor(cur, pos) {
    if (!cur || !pos) return;
    var parts = pos.split(' ');
    if (parts.length !== 2) return;
    cur.style.left = parts[0];
    cur.style.top = parts[1];
  }

  function showCursors() {
    if (johnCur) johnCur.classList.add('in');
    if (agentCur) agentCur.classList.add('in');
  }

  function hideCursors() {
    if (johnCur) johnCur.classList.remove('in');
    if (agentCur) agentCur.classList.remove('in');
  }

  function resetCursors() {
    if (johnCur) { johnCur.style.left = '70%'; johnCur.style.top = '8%'; }
    if (agentCur) { agentCur.style.left = '20%'; agentCur.style.top = '8%'; }
  }

  function resetKitButtons() {
    if (!sidebar) return;
    var btns = sidebar.querySelectorAll('[data-kit]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.classList.remove('clicked');
      if (b.getAttribute('data-kit') === 'charcoal') b.classList.add('active');
      else b.classList.remove('active');
    }
  }

  function startUpload(filename, duration) {
    if (!uploadBox) return;
    var fileEl = uploadBox.querySelector('.filename');
    var pctEl = uploadBox.querySelector('.pct');
    var fillEl = uploadBox.querySelector('.fill');
    if (fileEl) fileEl.textContent = filename;
    if (pctEl) pctEl.textContent = '0%';
    if (fillEl) fillEl.style.width = '0%';
    uploadBox.hidden = false;
    // schedule progress ticks
    var ticks = 20;
    for (var i = 1; i <= ticks; i++) {
      (function(idx) {
        timers.push(setTimeout(function() {
          var p = Math.round((idx / ticks) * 100);
          if (pctEl) pctEl.textContent = p + '%';
          if (fillEl) fillEl.style.width = p + '%';
        }, Math.round((idx / ticks) * duration)));
      })(i);
    }
    // hide after duration + small linger
    timers.push(setTimeout(function() {
      if (uploadBox) uploadBox.hidden = true;
    }, duration + 400));
  }

  function typeText(id, text) {
    var el = els[id];
    if (!el) return;
    el.textContent = '';
    for (var i = 0; i < text.length; i++) {
      (function(idx) {
        timers.push(setTimeout(function() {
          el.textContent = text.substring(0, idx + 1);
        }, idx * 35));
      })(i);
    }
  }

  function fmtTs(ms) {
    var total = 28 + Math.floor(ms / 1000);
    var m = 4 + Math.floor(total / 60);
    var s = total % 60;
    return '[12:' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ']';
  }

  function addLog(ms, opName, ref) {
    if (!opName) return;
    var prev = feed.querySelector('.now');
    if (prev) prev.classList.remove('now');

    var row = document.createElement('div');
    row.className = 'row now demo-log-enter';

    var ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = fmtTs(ms);

    var op = document.createElement('span');
    op.className = 'op';

    var tag = document.createElement('span');
    tag.className = opName.charAt(0) === '+' ? 'add' : 'edit';
    tag.textContent = opName;
    op.appendChild(tag);

    if (ref) {
      op.appendChild(document.createTextNode(' ' + ref));
    }

    row.appendChild(ts);
    row.appendChild(op);
    feed.appendChild(row);

    while (feed.children.length > 25) feed.removeChild(feed.firstChild);
  }

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  function run() {
    clearTimers();
    hideAll();
    setKit('charcoal');
    resetKitButtons();
    resetCursors();
    if (uploadBox) uploadBox.hidden = true;
    while (feed.firstChild) feed.removeChild(feed.firstChild);

    // Bring cursors back in (they linger between cycles for continuity)
    timers.push(setTimeout(showCursors, 200));

    for (var i = 0; i < STEPS.length; i++) {
      (function(step) {
        timers.push(setTimeout(function() {
          var action = step[1];
          if (action === 'show') {
            var ids = step[2].split(',');
            for (var j = 0; j < ids.length; j++) show(ids[j]);
          } else if (action === 'type') {
            var parts = step[2].split('|');
            show(parts[0]);
            typeText(parts[0], parts[1]);
          } else if (action === 'kit') {
            setKit(step[2]);
          } else if (action === 'upload') {
            var u = step[2].split('|');
            startUpload(u[0], parseInt(u[1], 10) || 800);
          } else if (action === 'hide') {
            hideAll();
          }
          // Sidebar interactions
          var sb = step[5];
          if (sb) {
            if (action === 'kit') activateKit(sb);
            else flashCmp(sb);
          }
          // Cursor movement
          if (step[6]) moveCursor(johnCur, step[6]);
          if (step[7]) moveCursor(agentCur, step[7]);
          addLog(step[0], step[3], step[4]);
        }, step[0]));
      })(STEPS[i]);
    }

    timers.push(setTimeout(run, CYCLE));
  }

  function initScrollReveal() {
    var items = document.querySelectorAll('.scroll-reveal');
    if (!items.length || !window.IntersectionObserver) return;
    var obs = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('revealed');
          obs.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.15 });
    for (var i = 0; i < items.length; i++) obs.observe(items[i]);
  }

  function initCountUp() {
    var nodes = document.querySelectorAll('[data-count-to]');
    if (!nodes.length) return;
    function animate(node, target) {
      if (target === 0) { node.textContent = '0'; return; }
      var dur = 1200;
      var start = performance.now();
      function tick(now) {
        var p = Math.min((now - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if (!window.IntersectionObserver) {
      for (var i = 0; i < nodes.length; i++) {
        var t = parseInt(nodes[i].getAttribute('data-count-to'), 10);
        if (!isNaN(t)) animate(nodes[i], t);
      }
      return;
    }
    // threshold:0 — a single visible pixel is enough. The old threshold of
    // 0.5 never fired for stat-line items rendered partially in the fold,
    // so the SSR'd value was replaced with '0' and the count-up never ran
    // until the visitor scrolled past it.
    var obs = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        var target = parseInt(el.getAttribute('data-count-to'), 10);
        if (isNaN(target)) continue;
        obs.unobserve(el);
        animate(el, target);
      }
    }, { threshold: 0 });
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = '0';
      obs.observe(nodes[i]);
    }
  }

  function init() {
    canvas = document.getElementById('demo-canvas');
    feed = document.getElementById('demo-feed');
    sidebar = document.getElementById('demo-sidebar');
    uploadBox = document.getElementById('demo-sb-upload');
    johnCur = document.getElementById('demo-cursor-john');
    agentCur = document.getElementById('demo-cursor-agent');
    if (!canvas || !feed) return;
    resetCursors();

    for (var i = 0; i < ELS.length; i++) {
      var def = ELS[i];
      var el = document.createElement('div');
      el.className = 'demo-el ' + def[1];
      el.style.cssText = def[2];
      if (def[3]) el.textContent = def[3];
      canvas.appendChild(el);
      els[def[0]] = el;
    }

    run();
    initScrollReveal();
    initCountUp();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;

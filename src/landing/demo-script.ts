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

  // [time, action, target, log_op, log_ref, sidebar_cmp]
  // sidebar_cmp = data-cmp value to flash in the sidebar Components grid
  // For 'kit' steps, sidebar_cmp is the kit data-kit value to toggle active
  var STEPS = [
    [300,   'show',   'nav',                                          '+section', 'nav',                  'nav'],
    [500,   'show',   'logo',                                         '+text',    '"rev01"',              'text'],
    [800,   'show',   'nav-lnk',                                      '+action',  '"Features" ghost',     'button'],
    [1100,  'show',   'nav-cta',                                      '+action',  '"Get started" solid',  'button'],
    [1600,  'show',   'hero-bg',                                      '+section', 'hero',                 'container'],
    [2000,  'type',   'hero-h|Ship a site that feels lived-in.',      '+heading', '"Ship a site..."',     'text'],
    [3400,  'show',   'hero-p',                                       '+text',    'body paragraph',       'text'],
    [3900,  'show',   'hero-btn',                                     '+action',  '"Start editing"',      'button'],
    [4300,  'upload', 'hero.jpg|900',                                  '+media',   'uploading hero.jpg',   'image'],
    [5300,  'show',   'hero-media',                                   null,       null,                   null],
    [5500,  'show',   'hero-orb',                                     '+shape',   'circle',               'shape'],
    [6000,  'show',   'f1,f1-dot,f1-txt',                             '+section', 'features',             'container'],
    [6300,  'show',   'f2,f2-dot,f2-txt',                             '+container', 'card x2',            'container'],
    [6600,  'show',   'f3,f3-dot,f3-txt',                             '+container', 'card x3',            'container'],
    [7100,  'show',   'cta-h',                                        '+heading', '"Publish when..."',    'text'],
    [7500,  'show',   'cta-b1',                                       '+action',  '"Open editor" pill',   'button'],
    [7800,  'show',   'cta-b2',                                       null,       null,                   'button'],
    [9500,  'kit',    'orange-editorial',                              'setTheme', 'orange-editorial',     'orange-editorial'],
    [11000, 'kit',    'blue-saas',                                     'setTheme', 'blue-saas',            'blue-saas'],
    [12500, 'kit',    'green-organic',                                 'setTheme', 'green-organic',        'green-organic'],
    [14000, 'hide',   '',                                              null,       null,                   null]
  ];

  var CYCLE = 15500;
  var canvas, feed, sidebar, uploadBox, els = {}, timers = [];

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
    if (uploadBox) uploadBox.hidden = true;
    while (feed.firstChild) feed.removeChild(feed.firstChild);

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
    if (!nodes.length || !window.IntersectionObserver) return;
    var obs = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        var target = parseInt(el.getAttribute('data-count-to'), 10);
        if (isNaN(target)) continue;
        obs.unobserve(el);
        if (target === 0) { el.textContent = '0'; continue; }
        var dur = 1200;
        var start = performance.now();
        (function(node, t) {
          function tick(now) {
            var p = Math.min((now - start) / dur, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            node.textContent = String(Math.round(t * eased));
            if (p < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        })(el, target);
      }
    }, { threshold: 0.5 });
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
    if (!canvas || !feed) return;

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

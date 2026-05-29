/* Open Canvas — per-site page shell (sidebar + topbar)
   Each page sets <body data-active="forms" data-crumb="Forms">. */
(function () {
  var ICONS = {
    editor: '<path d="M12 19l7-7 3 3-7 7-3-3zM2 22l1.5-5L14 6.5 17.5 10 7 20.5 2 22z" stroke-linejoin="round"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 4.6 13a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7 2 2 0 1 1 2.8-2.8A1.6 1.6 0 0 0 11 4.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 19.4 11"/>',
    nav: '<path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/>',
    forms: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h5" stroke-linecap="round"/>',
    versions: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2" stroke-linecap="round"/>',
    domains: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    addons: '<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 19l-4.8 2.5.9-5.4L4.2 8.3l5.4-.8z" stroke-linejoin="round"/>',
    a11y: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01" stroke-linecap="round"/>',
    assistant: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
  };
  var LINKS = [
    ['editor', 'Editor', 'editor.html'],
    ['settings', 'Settings', 'settings.html'],
    ['nav', 'Navigation', '#'],
    ['forms', 'Forms', 'forms.html'],
    ['versions', 'Versions', 'versions.html'],
    ['domains', 'Domains', 'domains.html'],
    ['addons', 'Add-ons', 'shop.html'],
    ['a11y', 'Accessibility', 'a11y.html'],
    ['assistant', 'Assistant', '#']
  ];
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + p + '</svg>'; }
  var active = document.body.dataset.active || '';
  var crumb = document.body.dataset.crumb || '';

  var side = document.getElementById('ocSide');
  if (side) {
    var html = '<a href="dashboard.html" class="back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>All sites</a>'
      + '<div class="site-id"><span class="ic"></span><span><b>Bloom &amp; Co.</b><small>bloomandco.opencanvas.site</small></span></div>';
    LINKS.forEach(function (l) {
      html += '<a href="' + l[2] + '" class="nav' + (l[0] === active ? ' active' : '') + '">' + svg(ICONS[l[0]]) + l[1] + '</a>';
    });
    html += '<div class="spacer"></div><a href="index.html" class="nav">' + svg(ICONS.home) + 'Design system</a>';
    side.innerHTML = html;
  }

  var top = document.getElementById('ocTop');
  if (top) {
    top.innerHTML = '<span class="crumb">Bloom &amp; Co. <span style="color:var(--ink-3)">/</span> <b>' + crumb + '</b></span>'
      + '<div class="sp"></div>'
      + '<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme"><svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19"/></svg><svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/></svg></button>'
      + '<a href="editor.html" class="btn btn-outline btn-sm">Open editor</a>'
      + '<a href="#" class="btn btn-primary btn-sm">Visit site ↗</a>';
    var tt = document.getElementById('themeToggle');
    tt.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('oc-theme', cur); } catch (e) {}
    });
  }
})();

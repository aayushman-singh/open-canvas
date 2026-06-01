// src/notifications/dashboard-inbox-script.ts
//
// Inline IIFE that wires the dashboard's notification bell + inbox dropdown.
// Sourced into src/routes/dashboard/shell.tsx as a `<script>{raw(...)}</script>`
// at body end so it runs after #notif-bell / #notif-badge / #notif-panel /
// #notif-list exist in the DOM.
//
// On load:
//   1. Fetch /api/notifications → render list + update badge.
//   2. Wire bell click → toggle panel.
//   3. Wire outside click + Esc → close panel.
//   4. Wire notif click → POST /:id/read + navigate to context.
//   5. Poll every 30s for new notifs (ADR 0043 Phase D's SSE will replace
//      polling — until then this is the live-delivery channel).
//
// All strings rendered into the DOM via textContent — no innerHTML on payload
// values — so a malicious payload can't surface as injection inside the panel.

export const notificationsInboxScript = `(function(){
  var bell = document.getElementById('notif-bell');
  var badge = document.getElementById('notif-badge');
  var panel = document.getElementById('notif-panel');
  var list = document.getElementById('notif-list');
  if (!bell || !badge || !panel || !list) return;

  function fmtTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString();
  }

  function txt(node, value) { node.appendChild(document.createTextNode(value || '')); }

  // Returns { title, detail, href } for a notification row.
  function describe(n) {
    var p = n.payload || {};
    var siteId = String(p.siteId || '');
    var siteName = String(p.siteName || 'a site');
    var siteHref = siteId ? '/dashboard/sites/' + encodeURIComponent(siteId) : '/dashboard';
    switch (n.kind) {
      case 'form_submission': {
        var formId = String(p.formElementId || '');
        var formsHref = siteId
          ? '/dashboard/sites/' + encodeURIComponent(siteId) + '/forms' + (formId ? '/' + encodeURIComponent(formId) : '')
          : '/dashboard';
        return {
          title: 'New form submission',
          detail: siteName + (p.pageSlug ? ' · ' + String(p.pageSlug) : ''),
          href: formsHref,
        };
      }
      case 'collaborator_event': {
        var action = String(p.action || '');
        var subject = String(p.subjectDisplayName || 'A teammate');
        var actor = p.actorDisplayName ? String(p.actorDisplayName) : null;
        var personal = n.recipientKind === 'customer';
        var title, detail;
        if (action === 'invited') {
          title = personal ? 'You were invited to ' + siteName : (actor || 'Someone') + ' invited ' + subject;
          detail = personal && actor ? 'From ' + actor : siteName;
        } else if (action === 'joined') {
          title = personal ? 'You joined ' + siteName : subject + ' joined ' + siteName;
          detail = personal ? 'Welcome aboard.' : '';
        } else {
          title = personal ? 'You left ' + siteName : subject + ' left ' + siteName;
          detail = '';
        }
        return { title: title, detail: detail, href: siteHref + '/collaborators' };
      }
      case 'access_event': {
        var change = String(p.change || '');
        var personalA = n.recipientKind === 'customer';
        var subjectA = String(p.subjectDisplayName || 'A teammate');
        var actorA = String(p.actorDisplayName || 'A site admin');
        var prev = String(p.previousRole || '');
        var next = p.nextRole == null ? null : String(p.nextRole);
        var title2, detail2;
        if (change === 'revoked') {
          title2 = personalA ? 'Your access to ' + siteName + ' was revoked' : actorA + ' removed ' + subjectA + ' from ' + siteName;
          detail2 = personalA ? 'By ' + actorA : '';
        } else {
          title2 = personalA ? 'Your role on ' + siteName + ' changed' : subjectA + "'s role on " + siteName + ' changed';
          detail2 = prev + (next ? ' → ' + next : '');
        }
        return { title: title2, detail: detail2, href: siteHref + '/collaborators' };
      }
      case 'publish_event': {
        var outcome = String(p.outcome || '');
        var version = p.publishedVersion;
        if (outcome === 'failed') {
          return {
            title: 'Publish failed on ' + siteName,
            detail: String(p.failureReason || 'Unknown failure'),
            href: siteHref,
          };
        }
        return {
          title: 'Published ' + siteName,
          detail: version != null ? 'Version ' + String(version) : '',
          href: siteHref,
        };
      }
      default:
        return { title: 'Notification', detail: '', href: '/dashboard' };
    }
  }

  function render(items) {
    list.replaceChildren();
    if (!items || items.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'notif-empty';
      empty.setAttribute('data-state', 'empty');
      empty.textContent = 'No notifications yet.';
      list.appendChild(empty);
      return;
    }
    items.forEach(function(n) {
      var d = describe(n);
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.className = 'notif-item' + (n.isRead ? '' : ' unread');
      a.href = d.href;
      a.setAttribute('data-id', n.id);
      var t = document.createElement('p');
      t.className = 'notif-item-title';
      txt(t, d.title);
      a.appendChild(t);
      if (d.detail) {
        var det = document.createElement('p');
        det.className = 'notif-item-detail';
        txt(det, d.detail);
        a.appendChild(det);
      }
      var time = document.createElement('span');
      time.className = 'notif-item-time';
      txt(time, fmtTime(n.createdAt));
      a.appendChild(time);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function setBadge(n) {
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.hidden = false;
    } else {
      badge.textContent = '0';
      badge.hidden = true;
    }
  }

  var loaded = false;
  function fetchInbox() {
    return fetch('/api/notifications?limit=20', { credentials: 'include' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        loaded = true;
        render(data.notifications);
        setBadge(data.unreadCount);
      })
      .catch(function() {});
  }

  function openPanel() {
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
    if (!loaded) fetchInbox();
  }
  function closePanel() {
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  }

  bell.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  });

  document.addEventListener('click', function(e) {
    if (panel.hidden) return;
    var t = e.target;
    if (t === bell || (t instanceof Node && (panel.contains(t) || bell.contains(t)))) return;
    closePanel();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault();
      closePanel();
    }
  });

  list.addEventListener('click', function(e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var a = target.closest('a.notif-item');
    if (!a) return;
    var id = a.getAttribute('data-id');
    if (!id) return;
    // Fire mark-read in background; let the anchor navigate.
    fetch('/api/notifications/' + encodeURIComponent(id) + '/read', {
      method: 'POST',
      credentials: 'include',
    }).catch(function() {});
    a.classList.remove('unread');
  });

  // Initial load + 30s poll (replaced by SSE in ADR 0043 Phase D).
  fetchInbox();
  setInterval(fetchInbox, 30000);
})();`;

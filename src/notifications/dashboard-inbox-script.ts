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
//   5. Subscribe to /api/notifications/stream and backfill on reconnect.
//
// All strings rendered into the DOM via textContent — no innerHTML on payload
// values — so a malicious payload can't surface as injection inside the panel.

export const notificationsInboxScript = `(function(){
  var bell = document.getElementById('notif-bell');
  var badge = document.getElementById('notif-badge');
  var panel = document.getElementById('notif-panel');
  var list = document.getElementById('notif-list');
  var markAll = document.getElementById('notif-mark-all');
  if (!bell || !badge || !panel || !list) return;
  // Either '/api' (dashboard, Clerk session) or '/__api' (on-site editor,
  // edit-token JWT). Set inline by the surface before this IIFE runs.
  var apiBase = (typeof window.__opencanvasInboxApiBase === 'string' && window.__opencanvasInboxApiBase) || '/api';

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
    if (markAll) markAll.hidden = n === 0;
  }

  var loaded = false;
  var lastSeenCreatedAt = null;
  var inboxItems = [];
  var inboxById = Object.create(null);

  function reportFailure(step, err) {
    var detail = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
    console.error('[notifications/inbox] ' + step + ' failed', detail);
  }

  function rememberNotifications(items, replace) {
    if (replace) {
      inboxItems = [];
      inboxById = Object.create(null);
    }
    (items || []).forEach(function(n) {
      if (!n || typeof n.id !== 'string') return;
      if (inboxById[n.id]) {
        Object.assign(inboxById[n.id], n);
      } else {
        inboxById[n.id] = n;
        inboxItems.push(n);
      }
      var created = Date.parse(n.createdAt);
      var seen = lastSeenCreatedAt ? Date.parse(lastSeenCreatedAt) : NaN;
      if (!isNaN(created) && (isNaN(seen) || created > seen)) {
        lastSeenCreatedAt = n.createdAt;
      }
    });
    inboxItems.sort(function(a, b) {
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }

  function fetchInbox(opts) {
    var since = opts && opts.since ? String(opts.since) : '';
    var url = apiBase + '/notifications?limit=20';
    if (since) url += '&since=' + encodeURIComponent(since);
    return fetch(url, { credentials: 'include' })
      .then(function(r) {
        if (r.ok) return r.json();
        return r.text().then(function(body) {
          throw new Error('GET ' + url + ' failed: ' + r.status + ' ' + body);
        });
      })
      .then(function(data) {
        if (!data || !Array.isArray(data.notifications)) {
          throw new Error('GET ' + url + ' returned malformed notifications payload');
        }
        loaded = true;
        rememberNotifications(data.notifications, !since);
        render(inboxItems.slice(0, 20));
        setBadge(data.unreadCount);
      });
  }

  function openPanel() {
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
    if (!loaded) fetchInbox().catch(function(err) { reportFailure('open fetch', err); });
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
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    var pendingNavigationHref = a.href;
    fetch(apiBase + '/notifications/' + encodeURIComponent(id) + '/read', {
      method: 'POST',
      credentials: 'include',
    })
      .then(function(r) {
        if (r.ok) return r.json();
        return r.text().then(function(body) {
          throw new Error('POST mark-read failed: ' + r.status + ' ' + body);
        });
      })
      .then(function() {
        a.classList.remove('unread');
        return fetchInbox();
      })
      .then(function() {
        window.location.assign(pendingNavigationHref);
      })
      .catch(function(err) { reportFailure('mark-read', err); });
  });

  if (markAll) {
    markAll.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var unreadText = badge && !badge.hidden ? badge.textContent : '0';
      if (!window.confirm('Mark all ' + (unreadText || '0') + ' notifications as read?')) return;
      fetch(apiBase + '/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'include',
      })
        .then(function(r) {
          if (r.ok) return r.json();
          return r.text().then(function(body) {
            throw new Error('POST mark-all-read failed: ' + r.status + ' ' + body);
          });
        })
        .then(function() { return fetchInbox(); })
        .catch(function(err) { reportFailure('mark-all-read', err); });
    });
  }

  fetchInbox().catch(function(err) { reportFailure('initial fetch', err); });

  // ADR 0043 Phase D live delivery. /api/notifications/stream upgrades to a
  // WebSocket backed by the per-Customer NotificationOwnerRoom DO, which
  // uses the Hibernation API so the DO is only billed for active pushes,
  // not for the idle hold time. Two frame kinds (JSON):
  //   - { kind: 'notification', id }        — a new row landed; refetch.
  //   - { kind: 'read-state-changed', id }  — another tab marked a row
  //                                            read; refetch so the badge
  //                                            + unread shading sync.
  // Per ADR dec 5 there is no in-DO buffer; on reconnect the next
  // fetchInbox call with since=lastSeenCreatedAt backfills any rows that
  // landed during the gap.
  //
  // Reconnect strategy: exponential backoff with jitter, and we skip the
  // socket entirely on hidden tabs so background dashboards don't keep the
  // DO warm (visibilitychange triggers an immediate reconnect on return).
  if (typeof window.WebSocket === 'function') {
    var wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var streamUrl = wsScheme + '//' + location.host + apiBase + '/notifications/stream';
    var streamOpened = false;
    var streamRetry = 0;
    var streamPending = false;
    var currentStreamSocket = null;
    function openStream() {
      if (document.visibilityState === 'hidden') {
        streamPending = true;
        return;
      }
      if (currentStreamSocket && currentStreamSocket.readyState !== WebSocket.CLOSED) return;
      currentStreamSocket = null;
      streamPending = false;
      var ws = new WebSocket(streamUrl);
      currentStreamSocket = ws;
      ws.addEventListener('open', function() {
        streamRetry = 0;
        if (streamOpened && lastSeenCreatedAt) {
          fetchInbox({ since: lastSeenCreatedAt }).catch(function(err) {
            reportFailure('stream reconnect backfill', err);
          });
        }
        streamOpened = true;
      });
      ws.addEventListener('message', function(ev) {
        var msg;
        try { msg = JSON.parse(ev.data); }
        catch (err) { reportFailure('stream parse', err); return; }
        if (!msg || typeof msg.kind !== 'string') return;
        if (msg.kind === 'notification') {
          fetchInbox().catch(function(err) { reportFailure('notification event fetch', err); });
        } else if (msg.kind === 'read-state-changed') {
          fetchInbox().catch(function(err) { reportFailure('read-state event fetch', err); });
        }
      });
      ws.addEventListener('close', function() {
        if (currentStreamSocket === ws) currentStreamSocket = null;
        if (document.visibilityState === 'hidden') {
          streamPending = true;
          return;
        }
        var base = Math.min(1000 * Math.pow(2, streamRetry), 30000);
        var delay = base + Math.random() * 500;
        streamRetry += 1;
        setTimeout(openStream, delay);
      });
      ws.addEventListener('error', function() {
        // Let the close handler schedule the reconnect; don't double-fire.
        ws.close();
      });
    }
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        streamPending = true;
        if (currentStreamSocket && currentStreamSocket.readyState !== WebSocket.CLOSED) {
          currentStreamSocket.close(1000, 'tab hidden');
          currentStreamSocket = null;
        }
        return;
      }
      if (document.visibilityState === 'visible' && streamPending) {
        streamRetry = 0;
        openStream();
      }
    });
    openStream();
  }
})();`;

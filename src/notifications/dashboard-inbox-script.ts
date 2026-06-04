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
      li.className = 'notif-item-row' + (n.isRead ? '' : ' is-unread');
      li.setAttribute('data-id', n.id);
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
      // Action cluster — siblings of the <a> so clicks don't bubble through
      // the row's navigation handler. Whole row stays an <a> for keyboard
      // nav + middle-click-to-open; the cluster is hidden until row hover
      // (CSS .notif-item-actions in bell-styles.ts).
      var actions = document.createElement('div');
      actions.className = 'notif-item-actions';
      // Tick — mark just this notif read. Hidden once the row is read so
      // only unread rows expose it.
      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'notif-item-action notif-item-tick';
      tick.setAttribute('aria-label', 'Mark as read');
      tick.setAttribute('data-notif-action', 'mark-read');
      tick.setAttribute('data-id', n.id);
      tick.setAttribute('title', 'Mark as read');
      tick.hidden = n.isRead;
      // U+2713 CHECK MARK as textContent so we keep the no-innerHTML
      // contract from the file header. Visually styled in bell-styles.ts.
      tick.textContent = '✓';
      actions.appendChild(tick);
      // Trash — delete this notif on the server + DOM. Always visible on
      // hover regardless of read state.
      var trash = document.createElement('button');
      trash.type = 'button';
      trash.className = 'notif-item-action notif-item-trash';
      trash.setAttribute('aria-label', 'Delete notification');
      trash.setAttribute('data-notif-action', 'delete');
      trash.setAttribute('data-id', n.id);
      trash.setAttribute('title', 'Delete notification');
      // U+2715 MULTIPLICATION X — recognisable as a "remove" glyph and
      // distinguishable from the tick. Styled red on hover via CSS.
      trash.textContent = '✕';
      actions.appendChild(trash);
      li.appendChild(actions);
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

  // Toast stack used by Mark all read + error surfaces. Styling lives in
  // bell-styles.ts (.notif-toast-*) so both the dashboard shell and the
  // canvas editor render the same toast without per-page CSS.
  function toast(message, kind) {
    var host = document.getElementById('notif-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notif-toast-host';
      host.className = 'notif-toast-host';
      document.body.appendChild(host);
    }
    var card = document.createElement('div');
    card.className = 'notif-toast' + (kind === 'error' ? ' is-error' : '');
    card.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    card.textContent = String(message);
    host.appendChild(card);
    requestAnimationFrame(function(){ card.classList.add('is-open'); });
    setTimeout(function(){
      card.classList.remove('is-open');
      setTimeout(function(){ if (card.parentNode) card.parentNode.removeChild(card); }, 220);
    }, 4000);
  }

  // Both surfaces (dashboard shell + canvas editor) must register
  // window.__opencanvasModal. If it is missing, fail this action loudly
  // instead of routing through a browser-native confirm with different chrome.
  function confirmStylized(message, opts) {
    var modal = window.__opencanvasModal;
    if (modal && typeof modal.confirm === 'function') {
      return modal.confirm(message, opts || {});
    }
    return Promise.reject(new Error('notification confirm modal is unavailable'));
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
    // Action buttons (tick / trash) live as siblings of the <a>. Handle
    // them BEFORE the row-navigation branch so a click on tick/trash never
    // navigates. e.stopPropagation() on the action also short-circuits the
    // outside-click → close-panel handler.
    var actionBtn = target.closest('button.notif-item-action');
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      var actionId = actionBtn.getAttribute('data-id');
      if (!actionId) return;
      var actionKind = actionBtn.getAttribute('data-notif-action');
      if (actionKind === 'mark-read') {
        actionBtn.disabled = true;
        fetch(apiBase + '/notifications/' + encodeURIComponent(actionId) + '/read', {
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
            // Update the DOM optimistically so the row is no longer styled
            // as unread and the tick disappears immediately; the fetchInbox
            // re-render below will redo this from the fresh server state.
            var row = actionBtn.closest('li.notif-item-row');
            if (row) {
              row.classList.remove('is-unread');
              var link = row.querySelector('a.notif-item');
              if (link) link.classList.remove('unread');
            }
            actionBtn.hidden = true;
            return fetchInbox();
          })
          .catch(function(err) {
            toast('Could not mark notification as read.', 'error');
            reportFailure('inline mark-read', err);
          })
          .then(function() { actionBtn.disabled = false; });
        return;
      }
      if (actionKind === 'delete') {
        actionBtn.disabled = true;
        fetch(apiBase + '/notifications/' + encodeURIComponent(actionId), {
          method: 'DELETE',
          credentials: 'include',
        })
          .then(function(r) {
            if (r.ok) return r.json();
            return r.text().then(function(body) {
              throw new Error('DELETE notification failed: ' + r.status + ' ' + body);
            });
          })
          .then(function() {
            // Drop the row from the DOM optimistically; fetchInbox will
            // re-render from the authoritative server state and update the
            // badge. Also evict from the local cache so we don't resurface
            // the row on the next render.
            var row = actionBtn.closest('li.notif-item-row');
            if (row && row.parentNode) row.parentNode.removeChild(row);
            if (inboxById[actionId]) {
              delete inboxById[actionId];
              inboxItems = inboxItems.filter(function(item) { return item.id !== actionId; });
            }
            return fetchInbox();
          })
          .catch(function(err) {
            toast('Could not delete notification.', 'error');
            reportFailure('inline delete', err);
          })
          .then(function() { actionBtn.disabled = false; });
        return;
      }
      return;
    }
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
      confirmStylized('Mark all ' + (unreadText || '0') + ' notifications as read?', {
        title: 'Mark all as read',
        confirmLabel: 'Mark all read',
      }).then(function(ok) {
        if (!ok) return;
        markAll.disabled = true;
        return fetch(apiBase + '/notifications/mark-all-read', {
          method: 'POST',
          credentials: 'include',
        })
          .then(function(r) {
            if (r.ok) return r.json();
            return r.text().then(function(body) {
              throw new Error('POST mark-all-read failed: ' + r.status + ' ' + body);
            });
          })
          .then(function(data) {
            var n = (data && typeof data.markedRead === 'number') ? data.markedRead : 0;
            toast(n === 0 ? 'No unread notifications.' : (n === 1 ? '1 notification marked read.' : n + ' notifications marked read.'));
            return fetchInbox();
          })
          .catch(function(err) {
            toast('Could not mark notifications as read.', 'error');
            reportFailure('mark-all-read', err);
          })
          .then(function() { markAll.disabled = false; });
      }).catch(function(err) {
        toast('Could not open notification confirmation.', 'error');
        reportFailure('mark-all-read confirm', err);
      });
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

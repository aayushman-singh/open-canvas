// src/notifications/bell-styles.ts
//
// Shared CSS for the notification bell + inbox dropdown. Both the dashboard
// shell (src/routes/dashboard/shell.tsx) and the canvas editor chrome
// (src/editor/canvas-styles.ts) inject this so the bell renders identically
// in both surfaces.
//
// `.notif-bell` is standalone (no dependence on .iconbtn) so it can land in
// the editor header without pulling the rest of the dashboard's chrome.
// Colour tokens come from src/ui/theme.css (--ink, --line, --red, etc.) so
// the bell tracks the theme on either surface.

export const bellStyles = `
.notif-wrap { position: relative; display: inline-flex; }
.notif-bell {
  position: relative;
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 999px;
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.notif-bell:hover { border-color: var(--ink); color: var(--ink); }
.notif-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--surface);
}
.notif-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 360px;
  max-height: 480px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r);
  box-shadow: var(--shadow-lg);
  z-index: 9000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.notif-panel[hidden] { display: none; }
.notif-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 12px 18px;
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.notif-mark-all {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.005em;
  padding: 6px 11px;
  border-radius: var(--r-pill);
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}
.notif-mark-all:hover { border-color: var(--ink); color: var(--ink); }
.notif-mark-all:disabled { opacity: 0.55; cursor: progress; }
.notif-mark-all[hidden] { display: none; }
.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.notif-list li {
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.5;
}
.notif-list li:last-child { border-bottom: none; }

/* Row wrapper for the inline action cluster. The cluster (tick + trash)
   sits absolutely-positioned in the row's right gutter; the row itself
   keeps the same padding so the link content position doesn't shift on
   hover. The action cluster is opacity-hidden until hover so resting
   rows stay calm. */
.notif-list li.notif-item-row { position: relative; padding-right: 70px; }
.notif-item-actions {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.notif-list li.notif-item-row:hover .notif-item-actions,
.notif-list li.notif-item-row:focus-within .notif-item-actions {
  opacity: 1;
  pointer-events: auto;
}
.notif-item-action {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background-color 0.12s;
}
.notif-item-action:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.notif-item-action:disabled { opacity: 0.55; cursor: progress; }
.notif-item-action[hidden] { display: none; }
.notif-item-tick:hover {
  border-color: var(--green, #16a34a);
  color: var(--green, #16a34a);
}
.notif-item-trash:hover {
  border-color: var(--red);
  color: var(--red);
}
.notif-list .notif-empty {
  color: var(--ink-3);
  text-align: center;
  padding: 28px 18px;
  font-style: italic;
}
.notif-item {
  display: block;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  background: var(--surface);
  transition: background 0.12s;
}
.notif-item:hover { background: var(--paper); }
.notif-item.unread { background: var(--red-tint); }
.notif-item.unread:hover { background: var(--red-soft); }
.notif-item-title {
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 2px;
}
.notif-item-detail {
  color: var(--ink-2);
  font-size: 12.5px;
  margin: 0;
}
.notif-item-time {
  display: block;
  color: var(--ink-3);
  font-size: 11px;
  margin-top: 4px;
}

/* Toast stack used by the bell IIFE (Mark all read confirmation, errors).
   Lives outside .notif-wrap so it can sit at the page edge regardless of
   which surface mounts the bell. */
.notif-toast-host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10010;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.notif-toast {
  pointer-events: auto;
  min-width: 220px;
  max-width: 340px;
  padding: 11px 14px;
  background: var(--ink);
  color: var(--paper);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.4;
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.notif-toast.is-open { opacity: 1; transform: translateY(0); }
.notif-toast.is-error { background: var(--red); color: #fff; }
`;

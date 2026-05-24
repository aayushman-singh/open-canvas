export const uiStyles = `
/* ===================================================================
   rev01 UI primitives — single source of truth for buttons, badges,
   pills, and cards across the dashboard.

   Swap this file (+ primitives.tsx) to re-skin the entire app.
   Consumer code imports from src/ui/ and never references these
   classes directly.
   =================================================================== */

/* --- Buttons -------------------------------------------------------- */

.rev01-ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, filter 0.12s, border-color 0.12s, color 0.12s;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.rev01-ui-btn--sm { padding: 5px 10px; font-size: 12px; }
.rev01-ui-btn--md { padding: 8px 16px; font-size: 13px; }
.rev01-ui-btn--lg { padding: 10px 20px; font-size: 14px; }

.rev01-ui-btn--primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.rev01-ui-btn--primary:hover { filter: brightness(0.88); }

.rev01-ui-btn--secondary {
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
  border-color: var(--line);
}
.rev01-ui-btn--secondary:hover {
  background: rgba(255, 255, 255, 0.10);
  color: var(--text);
  border-color: rgba(255, 255, 255, 0.2);
}

.rev01-ui-btn--ghost {
  background: transparent;
  color: var(--muted);
  border-color: transparent;
}
.rev01-ui-btn--ghost:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.rev01-ui-btn--danger {
  background: transparent;
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.5);
}
.rev01-ui-btn--danger:hover {
  background: rgba(248, 113, 113, 0.08);
  color: #fda4a4;
}

.rev01-ui-btn:disabled,
.rev01-ui-btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
  pointer-events: none;
}

.rev01-ui-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* --- Badges --------------------------------------------------------- */

.rev01-ui-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  line-height: 1.3;
  white-space: nowrap;
}

.rev01-ui-badge--success {
  background: rgba(74, 222, 128, 0.1);
  border-color: rgba(74, 222, 128, 0.4);
  color: #86efac;
}

.rev01-ui-badge--warning {
  background: rgba(250, 204, 21, 0.1);
  border-color: rgba(250, 204, 21, 0.4);
  color: #fde047;
}

.rev01-ui-badge--danger {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.4);
  color: #fca5a5;
}

.rev01-ui-badge--info {
  background: rgba(125, 211, 252, 0.1);
  border-color: rgba(125, 211, 252, 0.4);
  color: #7dd3fc;
}

.rev01-ui-badge--neutral {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.32);
  color: #cbd5e1;
}

/* --- Pills ---------------------------------------------------------- */

.rev01-ui-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.rev01-ui-pill--on {
  background: rgba(74, 222, 128, 0.10);
  color: #4ade80;
}

.rev01-ui-pill--off {
  background: rgba(255, 255, 255, 0.04);
  color: var(--faint);
}

.rev01-ui-pill--info {
  background: rgba(125, 211, 252, 0.08);
  color: var(--accent);
}

/* --- Cards ---------------------------------------------------------- */

.rev01-ui-card {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  margin-bottom: 18px;
}

.rev01-ui-card h2 {
  margin: 0 0 6px;
  font-size: 18px;
  letter-spacing: -0.005em;
}

.rev01-ui-card .sub {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.55;
}

/* --- Inputs --------------------------------------------------------- */

.rev01-ui-input,
.rev01-ui-textarea,
.rev01-ui-select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 10px 12px;
  font-size: 15px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.rev01-ui-input:focus,
.rev01-ui-textarea:focus,
.rev01-ui-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.15);
}

.rev01-ui-textarea {
  min-height: 90px;
  resize: vertical;
}

/* --- Form field ----------------------------------------------------- */

.rev01-ui-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
`;

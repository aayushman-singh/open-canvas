import type { BillingPlan } from '../db/schema';
import { siteLimitForPlan, storageLimitForPlan, billingPlanLabel } from './plan-limits';

// ADR 0042 (2026-06-04 amendment) — the Plan picker is the canonical
// upgrade affordance. Rendered both in the Account page Plan tab and in
// the dashboard "Upgrade to add sites" modal. The shape is identical in
// both surfaces because they share this component; the click handler
// (inline JS, per page) is what differs — the modal closes itself on
// success, the Plan tab page just reloads.
//
// `data-plan` on each Switch button is the contract the per-page inline
// scripts read to know which plan was clicked; do not rename without
// updating both scripts.

const PLAN_ORDER: ReadonlyArray<BillingPlan> = ['free', 'pro', 'team'];

const PLAN_PRICE_LABEL: Record<BillingPlan, string> = {
  free: '$0',
  pro: '$19',
  team: '$49',
};

function formatStorage(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(0) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  return bytes + ' B';
}

function siteCapLabel(plan: BillingPlan): string {
  const limit = siteLimitForPlan(plan);
  return limit === null ? 'Unlimited sites' : `${String(limit)} sites`;
}

export function PlanTiles({ currentPlan }: { currentPlan: BillingPlan }) {
  return (
    <div class="plan-tiles" role="list">
      {PLAN_ORDER.map((plan) => {
        const isCurrent = plan === currentPlan;
        const price = PLAN_PRICE_LABEL[plan];
        const cadence = plan === 'free' ? 'forever' : 'per month';
        return (
          <div class={isCurrent ? 'plan-tile is-current' : 'plan-tile'} role="listitem">
            <div class="plan-tile-head">
              <div class="plan-name">{billingPlanLabel(plan)}</div>
              {isCurrent ? <div class="plan-badge">Current</div> : null}
            </div>
            <div class="plan-price">
              <span class="plan-price-num">{price}</span>
              <span class="plan-price-cadence">{cadence}</span>
            </div>
            <ul class="plan-caps">
              <li>{siteCapLabel(plan)}</li>
              <li>{formatStorage(storageLimitForPlan(plan))} storage</li>
            </ul>
            {isCurrent ? (
              <button
                type="button"
                class="btn btn-outline plan-switch-btn"
                disabled
                aria-disabled="true"
              >
                Current plan
              </button>
            ) : (
              <button type="button" class="btn btn-primary plan-switch-btn" data-plan={plan}>
                Switch to {billingPlanLabel(plan)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Shared CSS for both surfaces (Plan tab + dashboard modal). Imported
// alongside per-page styles so the tile shape is identical wherever it
// renders.
export const planTilesStyles = `
  .plan-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .plan-tile {
    padding: 18px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .plan-tile.is-current {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .plan-tile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .plan-name {
    font-family: var(--display);
    font-weight: 700;
    font-size: 16px;
    color: var(--ink);
  }
  .plan-badge {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--red-ink);
    background: var(--red-tint);
    border-radius: 99px;
    padding: 3px 9px;
  }
  .plan-price {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .plan-price-num {
    font-family: var(--display);
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -.02em;
    color: var(--ink);
  }
  .plan-price-cadence {
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .plan-caps {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 13px;
    color: var(--ink-2);
    display: grid;
    gap: 4px;
  }
  .plan-caps li::before {
    content: "•";
    color: var(--ink-3);
    margin-right: 6px;
  }
  .plan-switch-btn { margin-top: auto; }
  .plan-mock-note {
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--ink-3);
    line-height: 1.5;
  }
  @media (max-width: 760px) {
    .plan-tiles { grid-template-columns: 1fr; }
  }
`;

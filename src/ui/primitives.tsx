import type { Child } from 'hono/jsx';
import type { ButtonVariant, ButtonSize, BadgeVariant, PillVariant } from './types';

// Open Canvas component fan-out point. Each primitive emits one of the
// shared class names defined in src/ui/components.css (.btn / .chip /
// .card / .field). The variant prop API names are stable — consumer JSX
// in src/routes/dashboard/* does not change when the underlying class
// mapping shifts. See MIGRATION.md §3 for the mapping table.

function classes(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

// Button variant -> Open Canvas class. `danger` consolidates onto
// .btn-primary (red fill) because components.css ships only one red
// button style — primary action and destructive action share the same
// affordance in the Open Canvas system (see
// design_handoff_opencanvas_rebrand/design-references/styles.css).
// `secondary` maps to .btn-outline (white surface + hairline) since
// that is the closest match to the prior rev01 secondary affordance.
const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-outline',
  ghost: 'btn-ghost',
  danger: 'btn-primary',
};

const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

// The `rev01-ui-btn` / `rev01-ui-card` legacy class names are still
// referenced by per-page <style> blocks in src/routes/dashboard/templates.tsx,
// src/routes/dashboard/site-settings.tsx, and src/landing/styles.ts — those
// page-level overrides have not yet been migrated to the new .btn / .card
// selectors. The primitives emit both class names so existing layout
// overrides keep matching until §4+ rewrites those page-level styles.
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  class: userClass,
  href,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit';
  class?: string;
  href?: string;
  children?: Child;
} & Record<string, unknown>) {
  const cls = classes('btn', BUTTON_VARIANT_CLASS[variant], BUTTON_SIZE_CLASS[size], 'rev01-ui-btn', userClass);
  if (href) {
    return (
      <a href={href} class={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} class={cls} {...rest}>
      {children}
    </button>
  );
}

// Badge and Pill both render as .chip — they were always near-duplicates
// of the same affordance and components.css only ships .chip. The
// variant prop selects the chip modifier (.chip-ok / .chip-red) or
// leaves the chip in its neutral surface-2 form.
const BADGE_VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'chip-ok',
  warning: '', // no .chip-warn in Open Canvas; neutral chip
  danger: 'chip-red',
  info: '',
  neutral: '',
};

export function Badge({
  variant = 'neutral',
  class: userClass,
  children,
}: {
  variant?: BadgeVariant;
  class?: string;
  children?: Child;
}) {
  return (
    <span class={classes('chip', BADGE_VARIANT_CLASS[variant], userClass)}>{children}</span>
  );
}

const PILL_VARIANT_CLASS: Record<PillVariant, string> = {
  on: 'chip-ok',
  off: '',
  info: '',
};

export function Pill({
  variant = 'off',
  class: userClass,
  children,
}: {
  variant?: PillVariant;
  class?: string;
  children?: Child;
}) {
  return (
    <span class={classes('chip', PILL_VARIANT_CLASS[variant], userClass)}>{children}</span>
  );
}

export function Card({
  id,
  class: userClass,
  style,
  children,
}: {
  id?: string;
  class?: string;
  style?: string;
  children?: Child;
}) {
  return (
    <section
      class={classes('card', 'rev01-ui-card', userClass)}
      {...(id ? { id } : {})}
      {...(style ? { style } : {})}
    >
      {children}
    </section>
  );
}

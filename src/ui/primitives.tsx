import type { Child } from 'hono/jsx';
import type { ButtonVariant, ButtonSize, BadgeVariant, PillVariant } from './types';

function classes(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

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
  const cls = classes(
    'rev01-ui-btn',
    `rev01-ui-btn--${variant}`,
    `rev01-ui-btn--${size}`,
    userClass,
  );
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
    <span class={classes('rev01-ui-badge', `rev01-ui-badge--${variant}`, userClass)}>
      {children}
    </span>
  );
}

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
    <span class={classes('rev01-ui-pill', `rev01-ui-pill--${variant}`, userClass)}>{children}</span>
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
      class={classes('rev01-ui-card', userClass)}
      {...(id ? { id } : {})}
      {...(style ? { style } : {})}
    >
      {children}
    </section>
  );
}

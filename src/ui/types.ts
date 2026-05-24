import type { Child } from 'hono/jsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type PillVariant = 'on' | 'off' | 'info';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit';
  disabled?: boolean;
  id?: string;
  class?: string;
  children?: Child;
  [key: `data-${string}`]: string | boolean | undefined;
  [key: `aria-${string}`]: string | boolean | undefined;
  title?: string;
  style?: string;
  hidden?: boolean;
  href?: string;
}

export interface BadgeProps {
  variant?: BadgeVariant;
  class?: string;
  children?: Child;
}

export interface PillProps {
  variant?: PillVariant;
  class?: string;
  children?: Child;
}

export interface CardProps {
  class?: string;
  style?: string;
  children?: Child;
}

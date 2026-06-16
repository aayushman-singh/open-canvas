import { validateInteractionTrigger, type InteractionTrigger } from './interactions';

export type OverlayModality = 'modal' | 'non-modal';

export type OverlayBodyScroll = 'lock' | 'allow';

export type OverlayPlacement =
  | { type: 'center' }
  | { type: 'fullscreen' }
  | { type: 'anchored'; anchorElementId: string; side: 'top' | 'right' | 'bottom' | 'left' };

export interface OverlayDismissal {
  closeButton: boolean;
  escapeKey: boolean;
  backdropClick: boolean;
  routeChange: boolean;
}

export type OverlayFocusTarget =
  | { type: 'overlay' }
  | { type: 'first-focusable' }
  | { type: 'element'; elementId: string }
  | { type: 'trigger' };

export interface OverlayFocusContract {
  initial: OverlayFocusTarget;
  returnTo: OverlayFocusTarget;
  trap: boolean;
}

export interface Overlay {
  id: string;
  contentSectionId: string;
  trigger: InteractionTrigger;
  modality: OverlayModality;
  placement: OverlayPlacement;
  dismissal: OverlayDismissal;
  focus: OverlayFocusContract;
  bodyScroll: OverlayBodyScroll;
  openSequenceId?: string;
  closeSequenceId?: string;
}

type ObjectRecord = Record<string, unknown>;

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(field: string, reason: string): never {
  throw new Error(`Invalid overlay.${field}: ${reason}`);
}

function validateNonEmptyString(field: string, value: unknown): void {
  if (!isNonEmptyString(value)) {
    fail(field, 'must be a non-empty string');
  }
}

function validateTrigger(trigger: unknown): void {
  try {
    validateInteractionTrigger(trigger as InteractionTrigger, 'overlay.trigger');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message.replace('[interactions] overlay.', 'Invalid overlay.'));
    }
    throw error;
  }
}

function validatePlacement(placement: unknown): void {
  if (!isObjectRecord(placement)) {
    fail('placement', 'must be an object');
  }

  if (placement.type === 'center' || placement.type === 'fullscreen') {
    return;
  }

  if (placement.type !== 'anchored') {
    fail('placement.type', 'must be center, fullscreen, or anchored');
  }

  if (!isNonEmptyString(placement.anchorElementId)) {
    fail('placement.anchorElementId', 'anchored placement must carry a non-empty anchorElementId');
  }

  if (
    placement.side !== 'top' &&
    placement.side !== 'right' &&
    placement.side !== 'bottom' &&
    placement.side !== 'left'
  ) {
    fail('placement.side', 'anchored placement side must be top, right, bottom, or left');
  }
}

function validateDismissal(dismissal: unknown): void {
  if (!isObjectRecord(dismissal)) {
    fail('dismissal', 'must be an object');
  }

  const fields = ['closeButton', 'escapeKey', 'backdropClick', 'routeChange'] as const;
  for (const field of fields) {
    if (typeof dismissal[field] !== 'boolean') {
      fail(`dismissal.${field}`, 'must be a boolean');
    }
  }

  if (!fields.some((field) => dismissal[field] === true)) {
    fail('dismissal', 'at least one dismissal path must be enabled');
  }
}

function validateFocusTarget(field: string, target: unknown): void {
  if (!isObjectRecord(target)) {
    fail(field, 'must be an object');
  }

  if (target.type === 'overlay' || target.type === 'first-focusable' || target.type === 'trigger') {
    return;
  }

  if (target.type !== 'element') {
    fail(`${field}.type`, 'must be overlay, first-focusable, element, or trigger');
  }

  if (!isNonEmptyString(target.elementId)) {
    fail(`${field}.elementId`, 'element focus targets must carry a non-empty elementId');
  }
}

function validateFocus(focus: unknown, modality: OverlayModality): void {
  if (!isObjectRecord(focus)) {
    fail('focus', 'must be an object');
  }

  validateFocusTarget('focus.initial', focus.initial);
  validateFocusTarget('focus.returnTo', focus.returnTo);

  if (typeof focus.trap !== 'boolean') {
    fail('focus.trap', 'must be a boolean');
  }

  if (modality === 'modal' && focus.trap !== true) {
    fail('focus.trap', 'modal overlays must trap focus');
  }
}

function validateOptionalSequenceId(field: string, value: unknown): void {
  if (value !== undefined) validateNonEmptyString(field, value);
}

export function validateOverlay(overlay: Overlay): void {
  if (!isObjectRecord(overlay)) {
    fail('root', 'must be an object');
  }

  validateNonEmptyString('id', overlay.id);
  validateNonEmptyString('contentSectionId', overlay.contentSectionId);
  validateTrigger(overlay.trigger);

  if (overlay.modality !== 'modal' && overlay.modality !== 'non-modal') {
    fail('modality', 'must be modal or non-modal');
  }

  validatePlacement(overlay.placement);
  validateDismissal(overlay.dismissal);
  validateFocus(overlay.focus, overlay.modality);

  if (overlay.bodyScroll !== 'lock' && overlay.bodyScroll !== 'allow') {
    fail('bodyScroll', 'must be lock or allow');
  }

  validateOptionalSequenceId('openSequenceId', overlay.openSequenceId);
  validateOptionalSequenceId('closeSequenceId', overlay.closeSequenceId);
}

export type LoadExperienceRunPolicy = 'once-per-session' | 'every-visit';

export type LoadReadinessGate =
  | { type: 'document-ready' }
  | { type: 'fonts-ready' }
  | { type: 'asset-ready'; assetId: string }
  | { type: 'media-ready'; assetId: string; timeoutMs: number };

export interface LoadExperience {
  id: string;
  run: LoadExperienceRunPolicy;
  gates: LoadReadinessGate[];
  timeoutMs: number;
  introSequenceId?: string;
  exitSequenceId?: string;
  failureEvent: string;
}

export type RouteTransitionFocusTarget = { type: 'page' } | { type: 'element'; elementId: string };

export interface RouteTransition {
  id: string;
  trigger: { type: 'same-site-navigation' };
  outgoingSequenceId?: string;
  incomingSequenceId?: string;
  swapAt: 'after-outgoing' | 'with-outgoing';
  scrollRestoration: 'top' | 'preserve';
  focusTarget?: RouteTransitionFocusTarget;
  hydrate: true;
  failureEvent: string;
}

type ObjectRecord = Record<string, unknown>;

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(scope: 'loadExperience' | 'routeTransition', field: string, reason: string): never {
  throw new Error(`Invalid ${scope}.${field}: ${reason}`);
}

function requireObject(
  scope: 'loadExperience' | 'routeTransition',
  field: string,
  value: unknown,
): asserts value is ObjectRecord {
  if (!isObjectRecord(value)) {
    fail(scope, field, 'must be an object');
  }
}

function requireNonEmptyString(
  scope: 'loadExperience' | 'routeTransition',
  field: string,
  value: unknown,
): void {
  if (!isNonEmptyString(value)) {
    fail(scope, field, 'must be a non-empty string');
  }
}

function requireFiniteNonNegativeNumber(
  scope: 'loadExperience' | 'routeTransition',
  field: string,
  value: unknown,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(scope, field, 'must be a finite non-negative number');
  }
}

function validateOptionalId(
  scope: 'loadExperience' | 'routeTransition',
  field: string,
  value: unknown,
): void {
  if (value !== undefined) requireNonEmptyString(scope, field, value);
}

function validateLoadReadinessGate(gate: unknown, index: number): void {
  const label = `gates[${String(index)}]`;
  requireObject('loadExperience', label, gate);
  requireNonEmptyString('loadExperience', `${label}.type`, gate.type);

  switch (gate.type) {
    case 'document-ready':
    case 'fonts-ready':
      return;
    case 'asset-ready':
      requireNonEmptyString('loadExperience', `${label}.assetId`, gate.assetId);
      return;
    case 'media-ready':
      requireNonEmptyString('loadExperience', `${label}.assetId`, gate.assetId);
      requireFiniteNonNegativeNumber('loadExperience', `${label}.timeoutMs`, gate.timeoutMs);
      return;
    default:
      fail(
        'loadExperience',
        `${label}.type`,
        'must be document-ready, fonts-ready, asset-ready, or media-ready',
      );
  }
}

export function validateLoadExperience(loadExperience: LoadExperience): void {
  requireObject('loadExperience', 'root', loadExperience);
  requireNonEmptyString('loadExperience', 'id', loadExperience.id);

  if (loadExperience.run !== 'once-per-session' && loadExperience.run !== 'every-visit') {
    fail('loadExperience', 'run', 'must be once-per-session or every-visit');
  }

  if (!Array.isArray(loadExperience.gates) || loadExperience.gates.length === 0) {
    fail('loadExperience', 'gates', 'must contain at least one readiness gate');
  }

  loadExperience.gates.forEach(validateLoadReadinessGate);
  requireFiniteNonNegativeNumber('loadExperience', 'timeoutMs', loadExperience.timeoutMs);
  validateOptionalId('loadExperience', 'introSequenceId', loadExperience.introSequenceId);
  validateOptionalId('loadExperience', 'exitSequenceId', loadExperience.exitSequenceId);
  requireNonEmptyString('loadExperience', 'failureEvent', loadExperience.failureEvent);
}

function validateRouteTrigger(trigger: unknown): void {
  requireObject('routeTransition', 'trigger', trigger);

  if (trigger.type !== 'same-site-navigation') {
    fail('routeTransition', 'trigger.type', 'must be same-site-navigation');
  }
}

function validateRouteFocusTarget(focusTarget: unknown): void {
  requireObject('routeTransition', 'focusTarget', focusTarget);

  if (focusTarget.type === 'page') return;

  if (focusTarget.type !== 'element') {
    fail('routeTransition', 'focusTarget.type', 'must be page or element');
  }

  requireNonEmptyString('routeTransition', 'focusTarget.elementId', focusTarget.elementId);
}

export function validateRouteTransition(routeTransition: RouteTransition): void {
  requireObject('routeTransition', 'root', routeTransition);
  requireNonEmptyString('routeTransition', 'id', routeTransition.id);
  validateRouteTrigger(routeTransition.trigger);
  validateOptionalId('routeTransition', 'outgoingSequenceId', routeTransition.outgoingSequenceId);
  validateOptionalId('routeTransition', 'incomingSequenceId', routeTransition.incomingSequenceId);

  if (routeTransition.swapAt !== 'after-outgoing' && routeTransition.swapAt !== 'with-outgoing') {
    fail('routeTransition', 'swapAt', 'must be after-outgoing or with-outgoing');
  }

  if (
    routeTransition.scrollRestoration !== 'top' &&
    routeTransition.scrollRestoration !== 'preserve'
  ) {
    fail('routeTransition', 'scrollRestoration', 'must be top or preserve');
  }

  if (routeTransition.focusTarget !== undefined) {
    validateRouteFocusTarget(routeTransition.focusTarget);
  }

  if (routeTransition.hydrate !== true) {
    fail('routeTransition', 'hydrate', 'must be true');
  }

  requireNonEmptyString('routeTransition', 'failureEvent', routeTransition.failureEvent);
}

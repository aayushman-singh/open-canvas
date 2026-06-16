import type {
  LoadExperience,
  LoadReadinessGate,
  RouteTransition,
} from '../canvas/load-transitions.js';
import { validateLoadExperience, validateRouteTransition } from '../canvas/load-transitions.js';
import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import { field, selectInput } from './dom-builders.js';
import type { EditorContext } from './editor-context.js';
import { uuid } from './ids.js';

type LoadRouteTransitionInspectorContext = Pick<
  EditorContext,
  'state' | 'inspector' | 'captureForUndo' | 'scheduleSave' | 'renderInspector' | 'setStatus'
>;

export interface LoadExperienceInspectorConfig {
  run: LoadExperience['run'];
  gates: LoadReadinessGate[];
  timeoutMs: number;
  introSequenceId?: string | undefined;
  exitSequenceId?: string | undefined;
}

export interface RouteTransitionInspectorConfig {
  outgoingSequenceId?: string | undefined;
  incomingSequenceId?: string | undefined;
  swapAt: RouteTransition['swapAt'];
  scrollRestoration: RouteTransition['scrollRestoration'];
  focusTarget?: RouteTransition['focusTarget'] | undefined;
}

export interface RouteFocusTargetOption {
  value: string;
  label: string;
}

type SimpleLoadGateValue = 'document-ready' | 'fonts-ready' | 'custom';

const LOAD_FAILURE_EVENT = 'load-experience-failed';
const ROUTE_FAILURE_EVENT = 'route-transition-failed';
const LOAD_RUN_OPTIONS: Array<'none' | LoadExperience['run']> = [
  'none',
  'once-per-session',
  'every-visit',
];
const LOAD_GATE_OPTIONS: SimpleLoadGateValue[] = ['document-ready', 'fonts-ready', 'custom'];
const ROUTE_SWAP_OPTIONS: Array<'none' | RouteTransition['swapAt']> = [
  'none',
  'after-outgoing',
  'with-outgoing',
];
const ROUTE_SCROLL_OPTIONS: RouteTransition['scrollRestoration'][] = ['top', 'preserve'];

export function appendLoadRouteTransitionInspector(ctx: LoadRouteTransitionInspectorContext): void {
  if (!ctx.inspector) return;
  const state = requireState(ctx);
  validateExistingContractReferences(state);

  const heading = document.createElement('h3');
  heading.textContent = 'Load + route';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  appendLoadExperienceControls(ctx, state);
  appendRouteTransitionControls(ctx, state);
}

export function upsertLoadExperience(
  ctx: Pick<LoadRouteTransitionInspectorContext, 'state' | 'captureForUndo' | 'scheduleSave'>,
  config: LoadExperienceInspectorConfig,
): LoadExperience {
  const state = requireState(ctx);
  const loadExperience = buildLoadExperience(state, config);
  validateLoadExperience(loadExperience);
  validateOptionalMotionSequenceId(state, loadExperience.introSequenceId, 'introSequenceId');
  validateOptionalMotionSequenceId(state, loadExperience.exitSequenceId, 'exitSequenceId');

  ctx.captureForUndo();
  state.loadExperience = loadExperience;
  ctx.scheduleSave();
  return loadExperience;
}

export function removeLoadExperience(
  ctx: Pick<LoadRouteTransitionInspectorContext, 'state' | 'captureForUndo' | 'scheduleSave'>,
): void {
  const state = requireState(ctx);
  if (state.loadExperience === undefined) return;
  ctx.captureForUndo();
  delete state.loadExperience;
  ctx.scheduleSave();
}

export function upsertRouteTransition(
  ctx: Pick<LoadRouteTransitionInspectorContext, 'state' | 'captureForUndo' | 'scheduleSave'>,
  config: RouteTransitionInspectorConfig,
): RouteTransition {
  const state = requireState(ctx);
  const routeTransition = buildRouteTransition(state, config);
  validateRouteTransition(routeTransition);
  validateOptionalMotionSequenceId(state, routeTransition.outgoingSequenceId, 'outgoingSequenceId');
  validateOptionalMotionSequenceId(state, routeTransition.incomingSequenceId, 'incomingSequenceId');
  validateRouteFocusTarget(state, routeTransition.focusTarget);

  ctx.captureForUndo();
  state.routeTransition = routeTransition;
  ctx.scheduleSave();
  return routeTransition;
}

export function removeRouteTransition(
  ctx: Pick<LoadRouteTransitionInspectorContext, 'state' | 'captureForUndo' | 'scheduleSave'>,
): void {
  const state = requireState(ctx);
  if (state.routeTransition === undefined) return;
  ctx.captureForUndo();
  delete state.routeTransition;
  ctx.scheduleSave();
}

export function listRouteFocusTargets(state: EditableSite): RouteFocusTargetOption[] {
  const options: RouteFocusTargetOption[] = [
    { value: 'none', label: 'none' },
    { value: 'page', label: 'page' },
  ];
  const seen = new Set<string>();
  visitSiteElements(state, (element) => {
    if (seen.has(element.id)) return;
    seen.add(element.id);
    options.push({
      value: 'element:' + element.id,
      label: 'element: ' + element.id,
    });
  });
  return options;
}

function appendLoadExperienceControls(
  ctx: LoadRouteTransitionInspectorContext,
  state: EditableSite,
): void {
  if (!ctx.inspector) return;
  const load = state.loadExperience;
  const mode = selectInput(LOAD_RUN_OPTIONS, load?.run ?? 'none');
  mode.addEventListener('change', () => {
    if (mode.value === 'none') {
      removeLoadExperience(ctx);
      ctx.renderInspector();
      return;
    }
    upsertLoadExperience(ctx, {
      ...configFromLoadExperience(load),
      run: mode.value as LoadExperience['run'],
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Load experience', mode));

  if (load === undefined) return;

  const config = configFromLoadExperience(load);
  const gate = selectInput(LOAD_GATE_OPTIONS, simpleLoadGateValue(load.gates));
  gate.addEventListener('change', () => {
    if (gate.value === 'custom') {
      ctx.setStatus('Custom readiness gates are preserved but not editable here', 'info');
      return;
    }
    upsertLoadExperience(ctx, {
      ...config,
      gates: [{ type: gate.value as 'document-ready' | 'fonts-ready' }],
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Readiness gate', gate));

  const timeout = document.createElement('input');
  timeout.type = 'number';
  timeout.min = '0';
  timeout.max = '30000';
  timeout.step = '100';
  timeout.value = String(config.timeoutMs);
  timeout.addEventListener('change', () => {
    const next = readFiniteNonNegativeNumber(timeout.value);
    if (next === null) {
      timeout.value = String(config.timeoutMs);
      ctx.setStatus('Load timeout must be a finite non-negative number', 'error');
      return;
    }
    upsertLoadExperience(ctx, { ...config, timeoutMs: next });
  });
  ctx.inspector.appendChild(field('Load timeout (ms)', timeout));

  const intro = motionSequenceSelect(state, config.introSequenceId);
  intro.addEventListener('change', () => {
    upsertLoadExperience(ctx, {
      ...config,
      introSequenceId: optionalSelectValue(intro.value),
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Intro sequence', intro));

  const exit = motionSequenceSelect(state, config.exitSequenceId);
  exit.addEventListener('change', () => {
    upsertLoadExperience(ctx, {
      ...config,
      exitSequenceId: optionalSelectValue(exit.value),
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Exit sequence', exit));

  appendRemoveButton(ctx, 'Remove load experience', () => {
    removeLoadExperience(ctx);
    ctx.renderInspector();
  });
}

function appendRouteTransitionControls(
  ctx: LoadRouteTransitionInspectorContext,
  state: EditableSite,
): void {
  if (!ctx.inspector) return;
  const route = state.routeTransition;
  const mode = selectInput(ROUTE_SWAP_OPTIONS, route?.swapAt ?? 'none');
  mode.addEventListener('change', () => {
    if (mode.value === 'none') {
      removeRouteTransition(ctx);
      ctx.renderInspector();
      return;
    }
    upsertRouteTransition(ctx, {
      ...configFromRouteTransition(route),
      swapAt: mode.value as RouteTransition['swapAt'],
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Route transition', mode));

  if (route === undefined) return;

  const config = configFromRouteTransition(route);
  const outgoing = motionSequenceSelect(state, config.outgoingSequenceId);
  outgoing.addEventListener('change', () => {
    upsertRouteTransition(ctx, {
      ...config,
      outgoingSequenceId: optionalSelectValue(outgoing.value),
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Outgoing sequence', outgoing));

  const incoming = motionSequenceSelect(state, config.incomingSequenceId);
  incoming.addEventListener('change', () => {
    upsertRouteTransition(ctx, {
      ...config,
      incomingSequenceId: optionalSelectValue(incoming.value),
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Incoming sequence', incoming));

  const scroll = selectInput(ROUTE_SCROLL_OPTIONS, config.scrollRestoration);
  scroll.addEventListener('change', () => {
    upsertRouteTransition(ctx, {
      ...config,
      scrollRestoration: scroll.value as RouteTransition['scrollRestoration'],
    });
  });
  ctx.inspector.appendChild(field('After navigation', scroll));

  const focus = routeFocusSelect(state, config.focusTarget);
  focus.addEventListener('change', () => {
    upsertRouteTransition(ctx, {
      ...config,
      focusTarget: routeFocusTargetFromSelect(focus.value),
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Focus target', focus));

  appendRemoveButton(ctx, 'Remove route transition', () => {
    removeRouteTransition(ctx);
    ctx.renderInspector();
  });
}

function appendRemoveButton(
  ctx: LoadRouteTransitionInspectorContext,
  label: string,
  onClick: () => void,
): void {
  if (!ctx.inspector) return;
  const row = document.createElement('div');
  row.className = 'style-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'style-btn-clear';
  button.textContent = label;
  button.addEventListener('click', onClick);
  row.appendChild(button);
  ctx.inspector.appendChild(field('Remove', row));
}

function buildLoadExperience(
  state: EditableSite,
  config: LoadExperienceInspectorConfig,
): LoadExperience {
  const loadExperience: LoadExperience = {
    id: state.loadExperience?.id ?? nextSiteInteractionId(state, 'load'),
    run: config.run,
    gates: config.gates.map(cloneLoadReadinessGate),
    timeoutMs: config.timeoutMs,
    failureEvent: state.loadExperience?.failureEvent ?? LOAD_FAILURE_EVENT,
  };
  const introSequenceId = normalizeOptionalId(config.introSequenceId, 'introSequenceId');
  const exitSequenceId = normalizeOptionalId(config.exitSequenceId, 'exitSequenceId');
  if (introSequenceId !== undefined) loadExperience.introSequenceId = introSequenceId;
  if (exitSequenceId !== undefined) loadExperience.exitSequenceId = exitSequenceId;
  return loadExperience;
}

function buildRouteTransition(
  state: EditableSite,
  config: RouteTransitionInspectorConfig,
): RouteTransition {
  const routeTransition: RouteTransition = {
    id: state.routeTransition?.id ?? nextSiteInteractionId(state, 'route'),
    trigger: { type: 'same-site-navigation' },
    swapAt: config.swapAt,
    scrollRestoration: config.scrollRestoration,
    hydrate: true,
    failureEvent: state.routeTransition?.failureEvent ?? ROUTE_FAILURE_EVENT,
  };
  const outgoingSequenceId = normalizeOptionalId(config.outgoingSequenceId, 'outgoingSequenceId');
  const incomingSequenceId = normalizeOptionalId(config.incomingSequenceId, 'incomingSequenceId');
  if (outgoingSequenceId !== undefined) routeTransition.outgoingSequenceId = outgoingSequenceId;
  if (incomingSequenceId !== undefined) routeTransition.incomingSequenceId = incomingSequenceId;
  if (config.focusTarget !== undefined)
    routeTransition.focusTarget = cloneRouteFocusTarget(config.focusTarget);
  return routeTransition;
}

function configFromLoadExperience(
  loadExperience: LoadExperience | undefined,
): LoadExperienceInspectorConfig {
  return {
    run: loadExperience?.run ?? 'once-per-session',
    gates: loadExperience?.gates.map(cloneLoadReadinessGate) ?? [{ type: 'document-ready' }],
    timeoutMs: loadExperience?.timeoutMs ?? 2500,
    introSequenceId: loadExperience?.introSequenceId,
    exitSequenceId: loadExperience?.exitSequenceId,
  };
}

function configFromRouteTransition(
  routeTransition: RouteTransition | undefined,
): RouteTransitionInspectorConfig {
  return {
    outgoingSequenceId: routeTransition?.outgoingSequenceId,
    incomingSequenceId: routeTransition?.incomingSequenceId,
    swapAt: routeTransition?.swapAt ?? 'after-outgoing',
    scrollRestoration: routeTransition?.scrollRestoration ?? 'top',
    focusTarget: routeTransition?.focusTarget ?? { type: 'page' },
  };
}

function requireState(ctx: Pick<LoadRouteTransitionInspectorContext, 'state'>): EditableSite {
  if (ctx.state === null) {
    throw new Error('load route transition inspector requires a loaded editor state');
  }
  return ctx.state;
}

function validateExistingContractReferences(state: EditableSite): void {
  if (state.loadExperience !== undefined) {
    validateOptionalMotionSequenceId(
      state,
      state.loadExperience.introSequenceId,
      'introSequenceId',
    );
    validateOptionalMotionSequenceId(state, state.loadExperience.exitSequenceId, 'exitSequenceId');
  }
  if (state.routeTransition !== undefined) {
    validateOptionalMotionSequenceId(
      state,
      state.routeTransition.outgoingSequenceId,
      'outgoingSequenceId',
    );
    validateOptionalMotionSequenceId(
      state,
      state.routeTransition.incomingSequenceId,
      'incomingSequenceId',
    );
    validateRouteFocusTarget(state, state.routeTransition.focusTarget);
  }
}

function validateOptionalMotionSequenceId(
  state: EditableSite,
  sequenceId: string | undefined,
  fieldName: string,
): void {
  if (sequenceId === undefined) return;
  const known = (state.motionSequences ?? []).some((sequence) => sequence.id === sequenceId);
  if (!known) {
    throw new Error(
      'load route transition inspector: ' +
        fieldName +
        ' references missing motion sequence "' +
        sequenceId +
        '"',
    );
  }
}

function validateRouteFocusTarget(
  state: EditableSite,
  focusTarget: RouteTransition['focusTarget'] | undefined,
): void {
  if (focusTarget === undefined || focusTarget.type === 'page') return;
  const elementIds = new Set<string>();
  visitSiteElements(state, (element) => {
    elementIds.add(element.id);
  });
  if (!elementIds.has(focusTarget.elementId)) {
    throw new Error(
      'load route transition inspector: focusTarget.elementId references missing element "' +
        focusTarget.elementId +
        '"',
    );
  }
}

function cloneLoadReadinessGate(gate: LoadReadinessGate): LoadReadinessGate {
  if (gate.type === 'document-ready' || gate.type === 'fonts-ready') return { type: gate.type };
  if (gate.type === 'asset-ready') return { type: 'asset-ready', assetId: gate.assetId };
  return { type: 'media-ready', assetId: gate.assetId, timeoutMs: gate.timeoutMs };
}

function cloneRouteFocusTarget(
  focusTarget: NonNullable<RouteTransition['focusTarget']>,
): NonNullable<RouteTransition['focusTarget']> {
  if (focusTarget.type === 'page') return { type: 'page' };
  return { type: 'element', elementId: focusTarget.elementId };
}

function simpleLoadGateValue(gates: LoadReadinessGate[]): SimpleLoadGateValue {
  if (gates.length !== 1) return 'custom';
  const gate = gates[0];
  if (gate === undefined) return 'custom';
  if (gate?.type === 'document-ready' || gate.type === 'fonts-ready') return gate.type;
  return 'custom';
}

function motionSequenceSelect(
  state: EditableSite,
  selected: string | undefined,
): HTMLSelectElement {
  if (selected !== undefined) validateOptionalMotionSequenceId(state, selected, 'motionSequence');
  const select = document.createElement('select');
  appendOption(select, '', 'none', selected === undefined);
  for (const sequence of state.motionSequences ?? []) {
    appendOption(select, sequence.id, sequence.id, sequence.id === selected);
  }
  return select;
}

function routeFocusSelect(
  state: EditableSite,
  focusTarget: RouteTransition['focusTarget'] | undefined,
): HTMLSelectElement {
  if (focusTarget !== undefined) validateRouteFocusTarget(state, focusTarget);
  const selected = routeFocusTargetToSelectValue(focusTarget);
  const select = document.createElement('select');
  for (const option of listRouteFocusTargets(state)) {
    appendOption(select, option.value, option.label, option.value === selected);
  }
  return select;
}

function appendOption(
  select: HTMLSelectElement,
  value: string,
  label: string,
  selected: boolean,
): void {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  select.appendChild(option);
}

function optionalSelectValue(value: string): string | undefined {
  if (value.length === 0) return undefined;
  return value;
}

function routeFocusTargetFromSelect(value: string): RouteTransition['focusTarget'] | undefined {
  if (value === 'none') return undefined;
  if (value === 'page') return { type: 'page' };
  if (value.startsWith('element:')) {
    const elementId = value.slice('element:'.length);
    if (elementId.length === 0) {
      throw new Error('load route transition inspector: focusTarget.elementId must be non-empty');
    }
    return { type: 'element', elementId };
  }
  throw new Error('load route transition inspector: unsupported focus target "' + value + '"');
}

function routeFocusTargetToSelectValue(
  focusTarget: RouteTransition['focusTarget'] | undefined,
): string {
  if (focusTarget === undefined) return 'none';
  if (focusTarget.type === 'page') return 'page';
  return 'element:' + focusTarget.elementId;
}

function normalizeOptionalId(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) {
    throw new Error('load route transition inspector: ' + fieldName + ' must be non-empty');
  }
  return value;
}

function readFiniteNonNegativeNumber(value: string): number | null {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  return next;
}

function nextSiteInteractionId(state: EditableSite, prefix: 'load' | 'route'): string {
  const existing = new Set<string>();
  if (state.loadExperience !== undefined) existing.add(state.loadExperience.id);
  if (state.routeTransition !== undefined) existing.add(state.routeTransition.id);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = prefix + '-' + uuid();
    if (!existing.has(id)) return id;
  }
  throw new Error('nextSiteInteractionId: failed to generate a unique id after 20 attempts');
}

function visitSiteElements(state: EditableSite, visit: (element: CanvasElement) => void): void {
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) visitElementTree(element, visit);
    }
  }
  for (const section of state.header === undefined ? [] : [state.header]) {
    for (const element of section.elements) visitElementTree(element, visit);
  }
  for (const section of state.footer === undefined ? [] : [state.footer]) {
    for (const element of section.elements) visitElementTree(element, visit);
  }
  for (const section of state.overlaySections ?? []) {
    for (const element of section.elements) visitElementTree(element, visit);
  }
}

function visitElementTree(element: CanvasElement, visit: (element: CanvasElement) => void): void {
  visit(element);
  if (element.type === 'tabs') {
    for (const tab of element.tabs) {
      for (const child of tab.elements) visitElementTree(child, visit);
    }
  }
  if (element.type === 'collection' && element.entries !== undefined) {
    for (const entry of element.entries) {
      for (const child of entry) visitElementTree(child, visit);
    }
  }
}

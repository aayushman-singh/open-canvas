import { validateOverlay, type Overlay } from './overlays';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrowsWithField(
  description: string,
  action: () => void,
  expectedField: string,
): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, `${description}: expected Error instance`);
    assert(
      error.message.includes(expectedField),
      `${description}: expected error to include "${expectedField}", got "${error.message}"`,
    );
    return;
  }

  throw new Error(`${description}: expected validation to fail`);
}

const validOverlay: Overlay = {
  id: 'project-detail',
  contentSectionId: 'overlay-project-detail',
  trigger: { type: 'click', elementId: 'project-card' },
  modality: 'modal',
  placement: { type: 'center' },
  dismissal: {
    closeButton: true,
    escapeKey: true,
    backdropClick: true,
    routeChange: true,
  },
  focus: {
    initial: { type: 'overlay' },
    returnTo: { type: 'trigger' },
    trap: true,
  },
  bodyScroll: 'lock',
  openSequenceId: 'overlay-open',
  closeSequenceId: 'overlay-close',
};

validateOverlay(validOverlay);

assertThrowsWithField(
  'empty contentSectionId',
  () => validateOverlay({ ...validOverlay, contentSectionId: '' }),
  'contentSectionId',
);

assertThrowsWithField(
  'no dismissal paths',
  () =>
    validateOverlay({
      ...validOverlay,
      dismissal: {
        closeButton: false,
        escapeKey: false,
        backdropClick: false,
        routeChange: false,
      },
    }),
  'dismissal',
);

assertThrowsWithField(
  'modal without focus trap',
  () =>
    validateOverlay({
      ...validOverlay,
      focus: { ...validOverlay.focus, trap: false },
    }),
  'focus.trap',
);

assertThrowsWithField(
  'click trigger without elementId',
  () =>
    validateOverlay({
      ...validOverlay,
      trigger: { type: 'click', elementId: '' },
    }),
  'trigger.elementId',
);

assertThrowsWithField(
  'unsupported trigger type',
  () =>
    validateOverlay({
      ...validOverlay,
      trigger: { type: 'unsupported' } as unknown as Overlay['trigger'],
    }),
  'trigger.type',
);

assertThrowsWithField(
  'empty open sequence id',
  () =>
    validateOverlay({
      ...validOverlay,
      openSequenceId: '',
    }),
  'openSequenceId',
);

assertThrowsWithField(
  'empty close sequence id',
  () =>
    validateOverlay({
      ...validOverlay,
      closeSequenceId: '',
    }),
  'closeSequenceId',
);

assertThrowsWithField(
  'hover trigger without elementId',
  () =>
    validateOverlay({
      ...validOverlay,
      trigger: { type: 'hover', elementId: '' },
    }),
  'trigger.elementId',
);

console.log('[overlays:smoke] OK');

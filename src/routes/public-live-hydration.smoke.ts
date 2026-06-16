import { runInNewContext } from 'node:vm';
import { __test_buildVisitorLiveScript } from './public';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[public-live-hydration:smoke] ${message}`);
}

type Listener = (event?: unknown) => void;

class FakeNode {
  constructor(readonly html: string) {}
}

class FakeRoot {
  childNodes: FakeNode[];
  readonly replaceCalls: FakeNode[][] = [];
  readonly innerAssignments: string[] = [];

  constructor(initialHtml: string) {
    this.childNodes = [new FakeNode(initialHtml)];
  }

  get innerHTML(): string {
    return this.childNodes.map((node) => node.html).join('');
  }

  set innerHTML(value: string) {
    this.innerAssignments.push(value);
    this.childNodes = [new FakeNode(value)];
  }

  replaceChildren(...nodes: FakeNode[]): void {
    this.replaceCalls.push(nodes);
    this.childNodes = nodes;
  }
}

class FakeTemplate {
  readonly content: { childNodes: FakeNode[] } = { childNodes: [] };

  set innerHTML(value: string) {
    this.content.childNodes = [new FakeNode(value)];
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.emit('close');
  }
}

interface HarnessOptions {
  initialHtml?: string;
  hydrate?: 'missing' | 'ok' | 'throw';
}

function makeHarness(options: HarnessOptions = {}): {
  root: FakeRoot;
  ws: FakeWebSocket;
  hydrateCalls: () => number;
  consoleErrors: string[];
} {
  FakeWebSocket.instances = [];
  const root = new FakeRoot(options.initialHtml ?? '<main>old</main>');
  const documentStub = {
    visibilityState: 'visible',
    addEventListener() {
      return undefined;
    },
    createElement(tagName: string) {
      if (tagName !== 'template') {
        throw new Error('[public-live-hydration:smoke] unexpected createElement ' + tagName);
      }
      return new FakeTemplate();
    },
    querySelector(selector: string) {
      return selector === '[data-opencanvas-public-root]' ? root : null;
    },
  };
  let hydrateCount = 0;
  const windowStub: { __opencanvasHydrate?: () => void } = {};
  if (options.hydrate === 'ok') {
    windowStub.__opencanvasHydrate = () => {
      hydrateCount++;
    };
  }
  if (options.hydrate === 'throw') {
    windowStub.__opencanvasHydrate = () => {
      hydrateCount++;
      throw new Error('hydrate failed');
    };
  }
  const consoleErrors: string[] = [];
  const consoleStub = {
    error(message: string) {
      consoleErrors.push(String(message));
    },
  };
  const locationStub = {
    protocol: 'https:',
    host: 'site.example.com',
    pathname: '/',
  };

  const script = __test_buildVisitorLiveScript(1);
  runInNewContext(script, {
    location: locationStub,
    document: documentStub,
    WebSocket: FakeWebSocket,
    setTimeout: () => 0,
    console: consoleStub,
    window: windowStub,
  });

  const ws = FakeWebSocket.instances[0];
  assert(ws !== undefined, 'visitor script must open a WebSocket');
  return { root, ws, hydrateCalls: () => hydrateCount, consoleErrors };
}

function replaceCallCount(root: FakeRoot): number {
  return root.replaceCalls.length;
}

function publish(ws: FakeWebSocket, version: number, html: string): void {
  ws.emit('message', {
    data: JSON.stringify({ version, html }),
  });
}

const interactiveHtml = '<main><section data-opencanvas-interactive="accordion"></section></main>';
const designerInteractiveHtml =
  '<main data-opencanvas-motion-sequence-count="1">' +
  '<script type="application/json" data-opencanvas-designer-interactions>{}</script>' +
  '<div data-opencanvas-overlay="project-detail"></div>' +
  '<div data-opencanvas-rich-motion="hero-lottie" data-opencanvas-rich-motion-family="vector-animation"></div>' +
  '</main>';

const ok = makeHarness({ hydrate: 'ok' });
publish(ok.ws, 2, interactiveHtml);
assert(
  ok.root.innerHTML.includes('data-opencanvas-interactive="accordion"'),
  'live update should replace public root HTML',
);
assert(replaceCallCount(ok.root) === 1, 'interactive live update should use replaceChildren');
assert(ok.root.innerAssignments.length === 0, 'interactive live update must not assign innerHTML');
assert(ok.hydrateCalls() === 1, 'interactive live update should call hydrator once');
assert(ok.consoleErrors.length === 0, 'hydrated live update should not log errors');

publish(ok.ws, 3, '<main><p>No interactions</p></main>');
assert(replaceCallCount(ok.root) === 2, 'static live update should use replaceChildren');
assert(ok.hydrateCalls() === 1, 'static live update should not call the hydrator');

publish(ok.ws, 4, designerInteractiveHtml);
assert(
  ok.root.innerHTML.includes('data-opencanvas-designer-interactions'),
  'designer interaction live update should replace public root HTML',
);
assert(
  replaceCallCount(ok.root) === 3,
  'designer interaction live update should use replaceChildren',
);
assert(ok.hydrateCalls() === 2, 'designer interaction live update should call hydrator once');

const missingHydrator = makeHarness({ initialHtml: '<main>old-static</main>', hydrate: 'missing' });
publish(missingHydrator.ws, 2, interactiveHtml);
assert(
  missingHydrator.root.innerHTML === '<main>old-static</main>',
  'missing hydrator must keep the current page active',
);
assert(
  replaceCallCount(missingHydrator.root) === 0,
  'missing hydrator must not swap public root nodes',
);
assert(
  missingHydrator.consoleErrors.some((message) => message.includes('hydrator missing')),
  'missing hydrator must emit an explicit error',
);

const missingDesignerHydrator = makeHarness({
  initialHtml: '<main>old-designer-static</main>',
  hydrate: 'missing',
});
publish(missingDesignerHydrator.ws, 2, designerInteractiveHtml);
assert(
  missingDesignerHydrator.root.innerHTML === '<main>old-designer-static</main>',
  'missing hydrator must keep current page active for designer interaction HTML',
);
assert(
  replaceCallCount(missingDesignerHydrator.root) === 0,
  'missing designer hydrator must not swap public root nodes',
);
assert(
  missingDesignerHydrator.consoleErrors.some((message) => message.includes('hydrator missing')),
  'missing designer hydrator must emit an explicit error',
);

const throwingHydrator = makeHarness({
  initialHtml: '<main>old-before-throw</main>',
  hydrate: 'throw',
});
const originalThrowingChild = throwingHydrator.root.childNodes[0];
publish(throwingHydrator.ws, 2, interactiveHtml);
assert(throwingHydrator.hydrateCalls() === 1, 'throwing hydrator should be attempted once');
assert(
  throwingHydrator.root.innerHTML === '<main>old-before-throw</main>',
  'hydrator failure must restore the current page',
);
assert(
  replaceCallCount(throwingHydrator.root) === 2,
  'hydrator failure must swap and restore with replaceChildren',
);
assert(
  throwingHydrator.root.childNodes.length === 1 &&
    throwingHydrator.root.childNodes[0] === originalThrowingChild,
  'hydrator failure must restore the original public root child nodes',
);
assert(
  throwingHydrator.root.innerAssignments.length === 0,
  'hydrator failure must not rebuild the current page through innerHTML',
);
assert(
  throwingHydrator.consoleErrors.some((message) => message.includes('hydration failed')),
  'hydrator failure must emit an explicit error',
);

const collectionOnly = makeHarness({
  initialHtml: '<main>old-collection</main>',
  hydrate: 'missing',
});
publish(
  collectionOnly.ws,
  2,
  '<main><section data-opencanvas-interactive="collection"></section></main>',
);
assert(
  collectionOnly.root.innerHTML.includes('data-opencanvas-interactive="collection"'),
  'collection-only HTML should not require the interactive runtime hydrator',
);
assert(
  replaceCallCount(collectionOnly.root) === 1,
  'collection-only update should use replaceChildren',
);
assert(collectionOnly.consoleErrors.length === 0, 'collection-only update should not log errors');

console.log('[public-live-hydration:smoke] OK');

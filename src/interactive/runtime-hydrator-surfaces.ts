// src/interactive/runtime-hydrator-surfaces.ts
//
// Canonical manifest for hydration surfaces that have both a visitor runtime
// dispatcher and an editor preview dispatcher. Visitor-only premium chrome
// such as Overlays, Load Experience, and Route Transition remain covered by
// their own runtime smokes plus the named window.__opencanvasHydrate boundary.

export interface RuntimeHydratorSurface {
  id: string;
  visitorCall: string;
  editorCall: string;
}

export const RUNTIME_HYDRATOR_SURFACES: RuntimeHydratorSurface[] = [
  {
    id: 'interactive:accordion',
    visitorCall: 'hydrateAccordion(root)',
    editorCall: 'hydrateAccordion(wrapper)',
  },
  {
    id: 'interactive:carousel',
    visitorCall: 'hydrateCarousel(root)',
    editorCall: 'hydrateCarousel(wrapper)',
  },
  {
    id: 'document:pointer-fx',
    visitorCall: 'hydratePointerFx(root, options || {})',
    editorCall: 'hydratePointerFx(root, options)',
  },
  {
    id: 'behaviour:preview',
    visitorCall: 'hydrateBehaviour(rootScope, options || {})',
    editorCall: 'hydrateBehaviourPreview(root, options.behaviourState',
  },
  {
    id: 'document:marquee',
    visitorCall: 'hydrateMarquees(rootScope, options || {})',
    editorCall: 'hydrateMarquees(root, options)',
  },
  {
    id: 'document:video-hover',
    visitorCall: 'hydrateVideoHoverStreams(rootScope, options || {})',
    editorCall: 'hydrateVideoHoverStreams(root, options)',
  },
];

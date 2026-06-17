export const ROUTE_TRANSITION_RUNTIME_SRC = String.raw`
function hydrateRouteTransition(scope, options) {
  var root = scope || document;
  var container = root.querySelector
    ? root.querySelector('[data-opencanvas-route-container]')
    : (root.querySelectorAll ? root.querySelectorAll('[data-opencanvas-route-container]')[0] : null);
  if (!container) return;
  if (container.getAttribute('data-opencanvas-route-hydrated') === 'true') return;
  container.setAttribute('data-opencanvas-route-hydrated', 'true');
}
`;

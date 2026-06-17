export const OVERLAY_RUNTIME_SRC = String.raw`
function hydrateOverlays(scope, options) {
  var root = scope || document;
  var nodes = root.querySelectorAll('[data-opencanvas-overlay]');
  for (var i = 0; i < nodes.length; i++) {
    var overlay = nodes[i];
    if (overlay.getAttribute('data-opencanvas-overlay-hydrated') === 'true') continue;
    overlay.setAttribute('data-opencanvas-overlay-hydrated', 'true');
  }
}
`;

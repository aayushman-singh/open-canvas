export const LOAD_EXPERIENCE_RUNTIME_SRC = String.raw`
function hydrateLoadExperience(scope, options) {
  var root = scope || document;
  var node = root.querySelector
    ? root.querySelector('[data-opencanvas-load-experience]')
    : (root.querySelectorAll ? root.querySelectorAll('[data-opencanvas-load-experience]')[0] : null);
  if (!node) return;
  if (node.getAttribute('data-opencanvas-load-hydrated') === 'true') return;
  node.setAttribute('data-opencanvas-load-hydrated', 'true');
}
`;

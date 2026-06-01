// src/interactive/carousel.ts
//
// Carousel runtime fragment. See `./accordion.ts` for the
// single-source-of-truth rationale (string emitted to visitor, evaluated as-is
// in smoke).
//
// Contract (DOM markers emitted by `src/canvas/elements/carousel.ts`):
//   - Outer wrapper:  `[data-opencanvas-interactive="carousel"]`
//                       `[data-opencanvas-slide-index="<N>"]` — runtime mutates
//                       `[data-opencanvas-slide-count="<total>"]` — read-only
//   - Each slide:     `[data-opencanvas-carousel-slide="<id>"]`
//                       `[data-opencanvas-carousel-slide-index="<N>"]`
//   - Prev/next:      `[data-opencanvas-carousel-prev]` / `[data-opencanvas-carousel-next]`
//   - Dots:           `[data-opencanvas-carousel-dot="<N>"]`
//                       aria-selected mirrors active state
//
// Bounds: index is clamped to `[0, count - 1]`. There is no wrap-around for
// the POC — the brief explicitly scopes out auto-play / infinite carousels.

export const CAROUSEL_RUNTIME_SRC = String.raw`
function hydrateCarousel(root) {
  var countAttr = root.getAttribute('data-opencanvas-slide-count');
  var count = countAttr ? parseInt(countAttr, 10) : 0;
  if (!(count > 0)) return;
  function readIndex() {
    var raw = root.getAttribute('data-opencanvas-slide-index');
    var n = raw ? parseInt(raw, 10) : 0;
    if (isNaN(n) || n < 0) n = 0;
    if (n > count - 1) n = count - 1;
    return n;
  }
  function setIndex(next) {
    if (next < 0) next = 0;
    if (next > count - 1) next = count - 1;
    root.setAttribute('data-opencanvas-slide-index', String(next));
    var dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
    for (var i = 0; i < dots.length; i++) {
      var dotIdx = parseInt(dots[i].getAttribute('data-opencanvas-carousel-dot') || '0', 10);
      dots[i].setAttribute('aria-selected', dotIdx === next ? 'true' : 'false');
    }
  }
  var prev = root.querySelector('[data-opencanvas-carousel-prev]');
  if (prev) {
    prev.addEventListener('click', function (event) {
      event.preventDefault();
      setIndex(readIndex() - 1);
    });
  }
  var next = root.querySelector('[data-opencanvas-carousel-next]');
  if (next) {
    next.addEventListener('click', function (event) {
      event.preventDefault();
      setIndex(readIndex() + 1);
    });
  }
  var dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
  for (var i = 0; i < dots.length; i++) {
    (function (dot) {
      dot.addEventListener('click', function (event) {
        event.preventDefault();
        var target = parseInt(dot.getAttribute('data-opencanvas-carousel-dot') || '0', 10);
        setIndex(target);
      });
    })(dots[i]);
  }
}
`;

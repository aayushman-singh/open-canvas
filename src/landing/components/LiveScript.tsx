import { raw } from 'hono/html';

const inlineScript = `(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var stats = {
    loc: 1247,
    ops: 42,
    suggestions: 12,
    sites: 0,
    commits: 6,
    editors: 3
  };
  function tick() {
    stats.ops += Math.floor(Math.random() * 3) + 1;
    if (Math.random() > 0.7) stats.loc += Math.floor(Math.random() * 4);
    if (Math.random() > 0.85) stats.suggestions += 1;
    if (Math.random() > 0.92) stats.editors = 2 + Math.floor(Math.random() * 4);
    Object.keys(stats).forEach(function (k) {
      var nodes = document.querySelectorAll('[data-stat="' + k + '"]');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].textContent = String(stats[k]);
      }
    });
  }
  setInterval(tick, 3000);
})();`;

export function LiveScript() {
  return <script>{raw(inlineScript)}</script>;
}

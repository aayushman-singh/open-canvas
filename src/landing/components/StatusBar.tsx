export function StatusBar() {
  return (
    <header class="statusbar" role="banner" aria-label="rev01 live build status">
      <span class="dot" aria-hidden="true"></span>
      <span class="seg">
        <span class="k">build</span>
        <span class="v">scaffolding</span>
      </span>
      <span class="sep">/</span>
      <span class="seg optional">
        <span class="k">commits/day</span>
        <span class="v" data-stat="commits">
          6
        </span>
      </span>
      <span class="sep">/</span>
      <span class="seg optional">
        <span class="k">editors online</span>
        <span class="v" data-stat="editors">
          3
        </span>
      </span>
      <nav class="nav" aria-label="primary">
        <a href="https://github.com/aayushman-singh/rev01/tree/main/docs" rel="noopener">
          docs/
        </a>
        <a href="https://github.com/aayushman-singh/rev01" rel="noopener">
          github/
        </a>
        <a class="cta" href="https://github.com/aayushman-singh/rev01" rel="noopener">
          launch -&gt;
        </a>
      </nav>
    </header>
  );
}

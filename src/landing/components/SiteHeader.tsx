export function SiteHeader() {
  return (
    <header class="site-header" role="banner" aria-label="rev01">
      <a class="wordmark" href="/">
        rev01
      </a>
      <nav class="nav" aria-label="primary">
        <a href="https://github.com/aayushman-singh/rev01/tree/main/docs" rel="noopener">
          Docs
        </a>
        <a href="https://github.com/aayushman-singh/rev01" rel="noopener">
          GitHub
        </a>
        <a class="button primary" href="/dashboard">
          Open dashboard
        </a>
      </nav>
    </header>
  );
}

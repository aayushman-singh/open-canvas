import { Button } from '../../ui';

export function StatusBar() {
  return (
    <header class="statusbar" role="banner" aria-label="rev01 navigation">
      <a href="/" class="statusbar-brand" style="text-decoration:none;border:none;">
        <span class="dot" aria-hidden="true"></span>
        <span class="brand-name">rev01</span>
      </a>
      <span class="spacer" />
      <nav class="nav" aria-label="primary">
        <a href="https://github.com/aayushman-singh/rev01/tree/main/docs" rel="noopener">
          docs
        </a>
        <a href="https://github.com/aayushman-singh/rev01" rel="noopener">
          github
        </a>
        <Button variant="primary" size="sm" href="/dashboard">
          Launch dashboard
        </Button>
      </nav>
    </header>
  );
}

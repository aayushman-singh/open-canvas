import { Button } from '../../ui';

const BUILD_STAMP = '2026-05-21';

export function Footer() {
  return (
    <footer aria-label="footer">
      <div class="footer-cta scroll-reveal">
        <h2 class="footer-heading">Ready to build?</h2>
        <p class="footer-sub">
          One canvas. One agent. Ship your site in minutes.
        </p>
        <Button variant="primary" href="/dashboard">
          Launch dashboard
        </Button>
      </div>
      <div class="footer-links">
        <span class="badge">
          <span class="pip" aria-hidden="true"></span>shipping in public
        </span>
        <span>
          <a href="https://github.com/aayushman-singh/rev01" rel="noopener">
            github
          </a>
        </span>
        <span>
          <a href="https://github.com/aayushman-singh/rev01/tree/main/docs" rel="noopener">
            docs
          </a>
        </span>
        <span>license: MIT</span>
        <span class="when">{BUILD_STAMP}</span>
      </div>
    </footer>
  );
}

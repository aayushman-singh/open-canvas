const BUILD_STAMP = '2026-05-21';

export function Footer() {
  return (
    <footer aria-label="footer">
      <span class="badge">
        <span class="pip" aria-hidden="true"></span>shipping in public
      </span>
      <span>
        source:{' '}
        <a href="https://github.com/aayushman-singh/rev01" rel="noopener">
          github.com/aayushman-singh/rev01
        </a>
      </span>
      <span>license: MIT</span>
      <span class="when">{BUILD_STAMP}</span>
    </footer>
  );
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
      <span class="when">{todayStamp()}</span>
    </footer>
  );
}

// Tiny helper for attaching `Server-Timing` metrics to a Hono response.
//
// Server-Timing surfaces per-stage timings to DevTools (Network panel ▸
// Timing tab) and to PerformanceObserver/PerformanceResourceTiming.serverTiming
// in the browser. Each entry is `name;dur=<ms>;desc="<label>"`, comma-joined
// in one header — what DevTools renders as the colored bars under each row.
//
// Use:
//
//   const t = new Timings();
//   const user = await t.measure('clerk', () => getClerkUser(c));
//   const rows = await t.measure('db.list', () => db.select(...));
//   c.header('Server-Timing', t.header());
//
// Or for synchronous spans:
//
//   const stop = t.start('render');
//   const html = renderSomething();
//   stop();
//
// Cloudflare Workers expose `performance.now()` and it's monotonic, so the
// numbers are good enough to compare stages within a single request. Across
// requests, isolate-cold-start cost shifts the absolute time around — useful
// for the FIRST entry (which captures whatever happens before the first
// measurement begins) but interpret the rest as relative slices.

export class Timings {
  private entries: Array<{ name: string; dur: number; desc?: string }> = [];

  /** Time an async operation and record the duration in ms. */
  async measure<T>(
    name: string,
    fn: () => Promise<T> | T,
    desc?: string,
  ): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.entries.push({ name, dur: performance.now() - t0, desc });
    }
  }

  /**
   * Manual span. Returns a stop() function that records the elapsed time
   * under `name`. Use when the work isn't a clean async function — e.g. a
   * loop, a sync render, a mid-handler boundary.
   */
  start(name: string, desc?: string): () => void {
    const t0 = performance.now();
    return () => {
      this.entries.push({ name, dur: performance.now() - t0, desc });
    };
  }

  /** Record a pre-measured duration. Use when something else timed the work. */
  mark(name: string, dur: number, desc?: string): void {
    this.entries.push({ name, dur, desc });
  }

  /** Format as a `Server-Timing` header value. */
  header(): string {
    return this.entries
      .map((e) => {
        // Trim to 1 decimal — keeps the header short, browsers don't need more.
        const parts = [e.name, `dur=${e.dur.toFixed(1)}`];
        if (e.desc) {
          // Description must be quoted; strip stray quotes to avoid header
          // breakage. Stage names should be ASCII identifiers anyway.
          parts.push(`desc="${e.desc.replace(/"/g, '')}"`);
        }
        return parts.join(';');
      })
      .join(', ');
  }
}

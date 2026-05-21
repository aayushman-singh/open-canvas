export function StatLine() {
  return (
    <section class="statline" aria-label="live counters">
      <span class="lead">
        <span class="dot" aria-hidden="true"></span>
        <span>RUNTIME</span>
      </span>
      <span class="stat">
        <span class="k">LOC</span>
        <span class="v" data-stat="loc">
          1247
        </span>
      </span>
      <span class="stat">
        <span class="k">edit ops today</span>
        <span class="v tick" data-stat="ops">
          42
        </span>
      </span>
      <span class="stat">
        <span class="k">agent suggestions</span>
        <span class="v" data-stat="suggestions">
          12
        </span>
      </span>
      <span class="stat">
        <span class="k">live sites</span>
        <span class="v" data-stat="sites">
          0
        </span>
      </span>
    </section>
  );
}

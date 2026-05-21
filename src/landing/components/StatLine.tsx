export function StatLine() {
  return (
    <section class="statline" aria-label="demo scenario counters">
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
        <span class="k">demo edit ops</span>
        <span class="v tick">42</span>
      </span>
      <span class="stat">
        <span class="k">demo agent ops</span>
        <span class="v">12</span>
      </span>
      <span class="stat">
        <span class="k">published sites</span>
        <span class="v">0</span>
      </span>
    </section>
  );
}

import { Button } from '../../ui';

export function Tagline() {
  return (
    <section class="tagline scroll-reveal" aria-label="product tagline">
      <span class="eyebrow">// rev01</span>
      <h1>
        multiplayer site builder with an <span class="accent">agent</span> at the cursor.
      </h1>
      <p>
        One canvas model, one Style Kit graph, one Published Address. The agent proposes concrete
        canvas edits you can preview, accept, and publish.
      </p>
      <div class="tagline-cta">
        <Button variant="primary" size="lg" href="/dashboard">
          Start building
        </Button>
        <Button variant="secondary" size="lg" href="https://github.com/aayushman-singh/rev01" target="_blank" rel="noopener">
          View source
        </Button>
      </div>
    </section>
  );
}

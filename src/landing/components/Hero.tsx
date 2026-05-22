import { HeroPanel } from './HeroPanel';

export function Hero() {
  return (
    <section class="hero" aria-label="hero — live editor, preview, agent">
      <div class="panel">
        <div class="titlebar" aria-hidden="true">
          <span class="glyphs">
            <span class="glyph close"></span>
            <span class="glyph min"></span>
            <span class="glyph max"></span>
          </span>
          <span class="path">
            <span class="accent">Editor</span> · Preview · Agent
          </span>
        </div>
        <div class="hero-grid">
          <HeroPanel kind="editor" />
          <HeroPanel kind="preview" />
          <HeroPanel kind="agent" />
        </div>
      </div>
    </section>
  );
}

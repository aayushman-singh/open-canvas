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
            rev01/<span class="accent">dashboard</span>/sites/maple-coffee/pages/home
          </span>
          <span class="right">3 collaborators · synced 4ms ago</span>
        </div>
        <div class="hero-grid">
          <HeroPanel kind="editor" />
          <HeroPanel kind="preview" />
          <HeroPanel kind="agent" />
        </div>
        <div class="hero-foot" aria-hidden="true">
          <span>
            <span class="ok">●</span> connected
          </span>
          <span class="sep">/</span>
          <span>3 collaborators</span>
          <span class="sep">/</span>
          <span>synced 4ms ago</span>
          <span class="right">124 edits/min</span>
        </div>
      </div>
    </section>
  );
}

type Kind = 'editor' | 'preview' | 'agent';

export function HeroPanel(props: { kind: Kind }) {
  if (props.kind === 'editor') return <EditorPanel />;
  if (props.kind === 'preview') return <PreviewPanel />;
  return <AgentPanel />;
}

function EditorPanel() {
  return (
    <div class="hero-panel" aria-label="editor pane">
      <div class="heading">
        <span class="kind">editor</span>
        <span>home.canvas.json</span>
      </div>
      <div class="body">
        <div class="editor-layout">
          <aside class="editor-tree" aria-hidden="true">
            <div class="row">
              <span class="icon">{'>'}</span>
              <span>pages/</span>
            </div>
            <div class="row active" style="margin-left: 0.6rem;">
              <span class="icon">·</span>
              <span>home</span>
            </div>
            <div class="row" style="margin-left: 0.6rem;">
              <span class="icon">·</span>
              <span>menu</span>
            </div>
            <div class="row" style="margin-left: 0.6rem;">
              <span class="icon">·</span>
              <span>about</span>
            </div>
            <div class="row">
              <span class="icon">{'>'}</span>
              <span>theme/</span>
            </div>
            <div class="row">
              <span class="icon">{'>'}</span>
              <span>assets/</span>
            </div>
          </aside>
          <div class="editor-doc">
            <div class="demo-heading" role="presentation">
              Brewed in small batches.
              <span class="cursor-token" aria-hidden="true">
                <span class="bar"></span>
                <span class="chip">you</span>
              </span>
            </div>
            <p>
              A neighbourhood roastery turning single-origin beans into a daily ritual. Open seven
              days, walk-ins welcome.
            </p>
            <p class="agent-line">
              Pour-over flights every Saturday morning&mdash;reservations encouraged
              <span class="cursor-token agent" aria-hidden="true">
                <span class="bar"></span>
                <span class="chip">&lt;agent: drafting hero...&gt;</span>
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel() {
  return (
    <div class="hero-panel" aria-label="live preview pane">
      <div class="heading">
        <span class="kind">preview</span>
        <span>your-site.rev01.dev</span>
      </div>
      <div class="body" style="padding:0.4rem;">
        <div class="demo-canvas" id="demo-canvas" data-kit="charcoal" aria-hidden="true"></div>
      </div>
    </div>
  );
}

function AgentPanel() {
  return (
    <div class="hero-panel" aria-label="agent operations log">
      <div class="heading">
        <span class="kind">agent</span>
        <span>ops.log</span>
      </div>
      <div class="body">
        <div class="agent-feed" id="demo-feed" aria-live="polite" aria-atomic="false"></div>
      </div>
    </div>
  );
}

type Kind = 'editor' | 'preview' | 'agent';

export function HeroPanel(props: { kind: Kind }) {
  if (props.kind === 'editor') return <EditorPanel />;
  if (props.kind === 'preview') return <PreviewPanel />;
  return <AgentPanel />;
}

function EditorPanel() {
  return (
    <div class="hero-panel" aria-label="editor sidebar">
      <div class="heading">
        <span class="kind">editor</span>
        <span>home.canvas.json</span>
      </div>
      <div class="body" style="padding:0;">
        <aside class="demo-sidebar" id="demo-sidebar" aria-hidden="true">
          <div class="demo-sb-tabs">
            <button type="button" class="active" data-tab="add">Add</button>
            <button type="button" data-tab="sections">Sections</button>
            <button type="button" data-tab="pages">Pages</button>
          </div>

          <div class="demo-sb-upload" id="demo-sb-upload" hidden>
            <div class="row">
              <span class="filename">hero.jpg</span>
              <span class="pct">0%</span>
            </div>
            <div class="bar">
              <div class="fill"></div>
            </div>
          </div>

          <div class="demo-sb-panel" data-panel="add">
            <div class="demo-sb-group">
              <h2>Sections</h2>
              <button type="button" class="demo-sb-cmd">+ Blank section</button>
            </div>
            <div class="demo-sb-group">
              <h2>Components</h2>
              <div class="demo-sb-cmd-grid">
                <button type="button" data-cmp="text">Text</button>
                <button type="button" data-cmp="image">Image</button>
                <button type="button" data-cmp="button">Button</button>
                <button type="button" data-cmp="shape">Shape</button>
                <button type="button" data-cmp="container">Container</button>
                <button type="button" data-cmp="nav">Nav</button>
                <button type="button" data-cmp="chart">Chart</button>
                <button type="button" data-cmp="form">Form</button>
              </div>
            </div>
            <div class="demo-sb-group">
              <h2>Style Kit</h2>
              <div class="demo-sb-kit-grid">
                <button type="button" class="active" data-kit="charcoal">charcoal</button>
                <button type="button" data-kit="orange-editorial">orange</button>
                <button type="button" data-kit="blue-saas">blue</button>
                <button type="button" data-kit="green-organic">green</button>
              </div>
            </div>
          </div>

          <div class="demo-sb-panel" data-panel="sections" hidden>
            <div class="demo-sb-empty">Saved sections appear here.</div>
          </div>

          <div class="demo-sb-panel" data-panel="pages" hidden>
            <div class="demo-sb-page-list">
              <div class="demo-sb-page-item" data-active="true">
                <span class="title">Home</span>
                <span class="slug">/</span>
              </div>
              <div class="demo-sb-page-item">
                <span class="title">About</span>
                <span class="slug">/about</span>
              </div>
            </div>
            <button type="button" class="demo-sb-action">+ New page</button>
          </div>
        </aside>
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

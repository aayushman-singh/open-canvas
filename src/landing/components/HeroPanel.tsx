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
        <span>home.doc.json</span>
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
            <h3>
              Brewed in small batches.
              <span class="cursor-token" aria-hidden="true">
                <span class="bar"></span>
                <span class="chip">you</span>
              </span>
            </h3>
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
        <span>maple-coffee.rev01.dev</span>
      </div>
      <div class="body">
        <div class="preview-frame" aria-hidden="true">
          <div class="pheader">
            <span class="brand">maple coffee.</span>
            <span class="pnav">
              <span>menu</span>
              <span>about</span>
              <span>visit</span>
            </span>
          </div>
          <div class="pbody">
            <div class="phero">Brewed in small batches.</div>
            <div class="pcopy">
              A neighbourhood roastery turning single-origin beans into a daily ritual. Open seven
              days, walk-ins welcome.
            </div>
            <div class="pcard">
              <span class="swatch"></span>
              <span>
                <strong>Saturday flight</strong>
                <br />
                three pour-overs, side by side
              </span>
              <span class="price">$14</span>
            </div>
          </div>
        </div>
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
        <div class="agent-feed">
          <div class="row">
            <span class="ts">[12:04:28]</span>
            <span class="op">
              <span class="add">+section</span> <span class="ref">hero</span>
            </span>
          </div>
          <div class="row">
            <span class="ts">[12:04:29]</span>
            <span class="op">
              <span class="add">+heading</span> "Brewed in small batches."
            </span>
          </div>
          <div class="row">
            <span class="ts">[12:04:30]</span>
            <span class="op">
              <span class="edit">editText</span> "Brewed near&hellip;" -&gt; "Brewed in&hellip;"
            </span>
          </div>
          <div class="row">
            <span class="ts">[12:04:31]</span>
            <span class="op">
              <span class="add">+card</span> <span class="ref">menu/saturday-flight</span>
            </span>
          </div>
          <div class="row">
            <span class="ts">[12:04:32]</span>
            <span class="op">
              <span class="edit">setTheme</span> palette -&gt; <span class="ref">amber-oak</span>
            </span>
          </div>
          <div class="row now">
            <span class="ts">[12:04:33]</span>
            <span class="op">
              <span class="edit">draftText</span> hero.subtitle&hellip;
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

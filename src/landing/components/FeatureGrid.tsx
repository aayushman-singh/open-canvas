const features = [
  {
    num: '01',
    title: 'One document, not a tree of editor widgets.',
    body: 'Every page is a single ProseMirror document. Selection spans sections; edits live in one timeline; there is no per-block conditional editor to maintain.',
  },
  {
    num: '02',
    title: 'CRDT runtime means no save button.',
    body: 'Yjs converges every keystroke from every editor in the room. Conflict resolution is the runtime — the question of "whose change wins" never reaches the UI.',
  },
  {
    num: '03',
    title: 'The agent is a collaborator, not a chat panel.',
    body: 'Claude holds a reserved client id, edits show up in the same revision history with everyone else, and its cursor moves through the document while it thinks.',
  },
];

export function FeatureGrid() {
  return (
    <section class="features" aria-label="differentiators">
      {features.map((f) => (
        <article class="feature">
          <span class="num">{f.num}</span>
          <h2>{f.title}</h2>
          <p>{f.body}</p>
        </article>
      ))}
    </section>
  );
}

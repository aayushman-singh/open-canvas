const features = [
  {
    num: '01',
    title: 'One canvas, not a tree of widgets.',
    body: 'Every page is a positioned canvas of text, media, actions, shapes, and surfaces. The editor speaks the same primitive model that publishing renders.',
  },
  {
    num: '02',
    title: 'Style Kits change the whole surface.',
    body: 'Typography, colour, surfaces, actions, and motion move together as one deterministic kit, so a site can shift language without rewriting its content.',
  },
  {
    num: '03',
    title: 'The agent proposes, the owner accepts.',
    body: 'AI edits travel through a small canvas tool vocabulary, preview against the current state, and only land after the Owner accepts the concrete op list.',
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

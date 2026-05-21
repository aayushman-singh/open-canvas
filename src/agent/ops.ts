// Typed document operations the agent can request.
//
// Each DocOp variant maps 1:1 to one entry in tools.ts; together they form the
// v0 surface the LLM is allowed to mutate. The set is intentionally small —
// the demo narrative ("ask the agent to change the headline, watch it stream")
// needs only a handful of well-shaped tools. Expansion gated on demand.
//
// Two apply functions are exported: one for the pure DocumentJSON used by the
// dry-run validator inside the orchestrator, and one for the live Y.Doc bound
// to ProseMirror inside the Durable Object. The latter routes through the
// ProseMirror schema + y-prosemirror so every applied op produces a Yjs update
// that broadcasts to all connected WS clients exactly the same as a human
// keystroke.

import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import type { DocumentJSON, SectionKind, SectionNode } from '../document/schema';
import { pmSchema, Y_XML_FRAGMENT_NAME } from '../multiplayer/pm-schema';

export type DocOp =
  | {
      kind: 'setHeadingText';
      sectionIndex: number;
      headingIndex: number;
      text: string;
    }
  | {
      kind: 'setParagraphText';
      sectionIndex: number;
      paragraphIndex: number;
      text: string;
    }
  | {
      kind: 'insertSection';
      index: number;
      sectionKind: SectionKind;
      headingText?: string;
      paragraphText?: string;
    }
  | {
      kind: 'removeSection';
      index: number;
    }
  | {
      kind: 'setActionLabel';
      sectionIndex: number;
      actionsIndex: number;
      actionIndex: number;
      label: string;
      href?: string;
    };

// ---------------------------------------------------------------------------
// Pure-data apply — operates on a DocumentJSON immutably. Used by the
// orchestrator to dry-run an op against the in-memory snapshot so the
// validator runs before the live Y.Doc is touched. Throws on invalid coords.
// ---------------------------------------------------------------------------

export function applyDocOp(doc: DocumentJSON, op: DocOp): DocumentJSON {
  switch (op.kind) {
    case 'setHeadingText':
      return mutateSectionBlock(doc, op.sectionIndex, op.headingIndex, 'heading', (block) => ({
        ...block,
        content: [{ type: 'text', text: op.text }],
      }));
    case 'setParagraphText':
      return mutateSectionBlock(doc, op.sectionIndex, op.paragraphIndex, 'paragraph', (block) => ({
        ...block,
        content: [{ type: 'text', text: op.text }],
      }));
    case 'insertSection':
      return insertSectionPure(doc, op);
    case 'removeSection':
      return removeSectionPure(doc, op.index);
    case 'setActionLabel':
      return mutateAction(doc, op);
  }
}

function mutateSectionBlock(
  doc: DocumentJSON,
  sectionIndex: number,
  blockIndex: number,
  expectedType: string,
  fn: (block: Record<string, unknown>) => Record<string, unknown>,
): DocumentJSON {
  const sections = doc.content;
  const section = sections[sectionIndex];
  if (!section) {
    throw new Error(`out-of-range sectionIndex=${sectionIndex} (have ${sections.length} sections)`);
  }
  const blocks = section.content;
  const block = blocks[blockIndex];
  if (!block) {
    throw new Error(
      `out-of-range block index ${blockIndex} in section ${sectionIndex} (have ${blocks.length} blocks)`,
    );
  }
  if (block.type !== expectedType) {
    throw new Error(
      `block at section ${sectionIndex} index ${blockIndex} is type "${block.type}", expected "${expectedType}"`,
    );
  }
  const nextBlock = fn(block as unknown as Record<string, unknown>);
  const nextBlocks = blocks.slice();
  nextBlocks[blockIndex] = nextBlock as never;
  const nextSection: SectionNode = { type: 'section', attrs: section.attrs, content: nextBlocks };
  const nextSections = sections.slice();
  nextSections[sectionIndex] = nextSection;
  return { type: 'doc', content: nextSections };
}

function insertSectionPure(
  doc: DocumentJSON,
  op: Extract<DocOp, { kind: 'insertSection' }>,
): DocumentJSON {
  const sections = doc.content;
  const index = clamp(op.index, 0, sections.length);
  const blocks: SectionNode['content'] = [];
  if (op.headingText && op.headingText.length > 0) {
    blocks.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: op.headingText }],
    });
  }
  if (op.paragraphText && op.paragraphText.length > 0) {
    blocks.push({
      type: 'paragraph',
      content: [{ type: 'text', text: op.paragraphText }],
    });
  }
  if (blocks.length === 0) {
    // A section must have at least one block per the schema; default to a
    // placeholder paragraph so validation passes.
    blocks.push({
      type: 'paragraph',
      content: [{ type: 'text', text: '...' }],
    });
  }
  const newSection: SectionNode = {
    type: 'section',
    attrs: { kind: op.sectionKind },
    content: blocks,
  };
  const next = sections.slice();
  next.splice(index, 0, newSection);
  return { ...doc, content: next };
}

function removeSectionPure(doc: DocumentJSON, index: number): DocumentJSON {
  const sections = doc.content;
  if (index < 0 || index >= sections.length) {
    throw new Error(`out-of-range index=${index} (have ${sections.length} sections)`);
  }
  if (sections.length <= 1) {
    throw new Error('cannot remove the last remaining section');
  }
  const next = sections.slice();
  next.splice(index, 1);
  return { type: 'doc', content: next };
}

function mutateAction(
  doc: DocumentJSON,
  op: Extract<DocOp, { kind: 'setActionLabel' }>,
): DocumentJSON {
  const sections = doc.content;
  const section = sections[op.sectionIndex];
  if (!section) {
    throw new Error(
      `out-of-range sectionIndex=${op.sectionIndex} (have ${sections.length} sections)`,
    );
  }
  const actionsBlock = section.content[op.actionsIndex];
  if (!actionsBlock) {
    throw new Error(`out-of-range actionsIndex=${op.actionsIndex}`);
  }
  if (actionsBlock.type !== 'actions') {
    throw new Error(
      `block at section ${op.sectionIndex} index ${op.actionsIndex} is "${actionsBlock.type}", expected "actions"`,
    );
  }
  const action = actionsBlock.content[op.actionIndex];
  if (!action) {
    throw new Error(`out-of-range actionIndex=${op.actionIndex}`);
  }
  const nextAction = {
    ...action,
    attrs: {
      ...action.attrs,
      label: op.label,
      ...(op.href !== undefined ? { href: op.href } : {}),
    },
  };
  const nextActions = actionsBlock.content.slice();
  nextActions[op.actionIndex] = nextAction;
  const nextActionsBlock = { ...actionsBlock, content: nextActions };
  const nextBlocks = section.content.slice();
  nextBlocks[op.actionsIndex] = nextActionsBlock;
  const nextSection: SectionNode = { type: 'section', attrs: section.attrs, content: nextBlocks };
  const nextSections = sections.slice();
  nextSections[op.sectionIndex] = nextSection;
  return { type: 'doc', content: nextSections };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

// ---------------------------------------------------------------------------
// Y.Doc apply — runs inside the PageDocument DO. The strategy: read the
// current doc from the Y.XmlFragment, apply the op as pure data to produce
// a new DocumentJSON, then rewrite the fragment in a single Y.transact with
// origin='agent'. Y.transact emits exactly one update event so connected WS
// clients receive one broadcast per agent op.
//
// We don't try to construct a minimal Y.XmlElement diff — replacing the
// fragment contents is simpler, idempotent, and respects every validator
// invariant by construction. The cost is a slightly larger Yjs update payload
// per op; acceptable at portfolio scale.
// ---------------------------------------------------------------------------

export interface ApplyOpToYDocResult {
  doc: DocumentJSON;
}

export function applyDocOpToYDoc(ydoc: Y.Doc, op: DocOp): ApplyOpToYDocResult {
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_NAME);
  // Read out a snapshot of the current state in DocumentJSON shape.
  const currentPM = yXmlFragmentToProsemirrorJSON(fragment) as Record<string, unknown>;
  const current = stripPmNoise(currentPM) as DocumentJSON;
  const next = applyDocOp(current, op);

  // Rewrite the fragment with the new doc, wrapped in a single transaction
  // tagged as 'agent' so the broadcast handler can distinguish agent edits.
  Y.transact(
    ydoc,
    () => {
      // Empty the fragment by deleting all children first; otherwise
      // prosemirrorJSONToYXmlFragment would append to the existing tree.
      fragment.delete(0, fragment.length);
      prosemirrorJSONToYXmlFragment(pmSchema, next, fragment);
    },
    'agent',
  );

  return { doc: next };
}

// Mirror of snapshot.ts stripPmNoise — kept local so this module stays
// self-contained and the orchestrator's dry-run isn't dragged through the
// persistSnapshot DB import chain.
function stripPmNoise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripPmNoise);
  if (node === null || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'attrs') {
      if (!v || typeof v !== 'object') continue;
      const cleaned: Record<string, unknown> = {};
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (av === null || av === undefined) continue;
        cleaned[ak] = av;
      }
      if (Object.keys(cleaned).length > 0) next.attrs = cleaned;
      continue;
    }
    if (k === 'marks') {
      const arr = (v as { type: string; attrs?: Record<string, unknown> }[]) ?? [];
      const cleaned: { type: string; attrs?: Record<string, unknown> }[] = [];
      for (const m of arr) {
        const out: { type: string; attrs?: Record<string, unknown> } = { type: m.type };
        if (m.attrs) {
          const a: Record<string, unknown> = {};
          for (const [ak, av] of Object.entries(m.attrs)) {
            if (av === null || av === undefined) continue;
            a[ak] = av;
          }
          if (Object.keys(a).length > 0) out.attrs = a;
        }
        cleaned.push(out);
      }
      if (cleaned.length > 0) next.marks = cleaned;
      continue;
    }
    if (k === 'content') {
      const arr = (v as unknown[]).map(stripPmNoise);
      if (arr.length > 0) next.content = arr;
      continue;
    }
    next[k] = v;
  }
  return next;
}

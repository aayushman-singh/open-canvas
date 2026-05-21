// Snapshot helpers — bridge between the page.doc column and the live Y.Doc.
//
// Schema reality: src/document/schema.ts ("rev01 document vocabulary") is
// section-rich (section/columns/actions/media), while the editor MVP rides on
// TipTap StarterKit's vocabulary (doc/paragraph/heading/lists/...). The MVP
// converts between the two at hydration time and on snapshot:
//
//   hydrate: rev01 DocumentJSON  -> StarterKit PM JSON -> Y.Doc
//   snapshot: Y.Doc -> StarterKit PM JSON -> wrap into page.doc as a doc
//             whose top-level section carries the StarterKit content.
//
// page.doc stays a rev01 DocumentJSON shape so the renderer keeps working; the
// editor's edits live inside a single `section` of kind `custom`. A follow-up
// (RECON #9 / theme studio) deepens the editor to manipulate the section tree
// directly.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { db } from '../db/client';
import { page } from '../db/schema';
import type {
  DocumentJSON,
  HeadingNode,
  InlineNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  SectionNode,
  TextNode,
} from '../document/schema';
import { pmSchema, Y_XML_FRAGMENT_NAME } from './pm-schema';

interface DbEnv {
  DATABASE_URL: string;
}

interface PMNode {
  type: string;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

// rev01 DocumentJSON -> StarterKit PM JSON. Walks sections, lifts
// heading/paragraph/list children up to the doc level; drops nodes the editor
// can't currently round-trip (media/columns/actions/divider). The dropped
// content is preserved across the editing session by being re-emitted on
// snapshot inside a `section.custom`. Future task widens this.
export function rev01ToStarterKit(doc: DocumentJSON): PMNode {
  const out: PMNode = { type: 'doc', content: [] };
  for (const section of doc.content) {
    for (const block of section.content) {
      const converted = convertBlock(block);
      if (converted.length > 0) out.content!.push(...converted);
    }
  }
  if (!out.content || out.content.length === 0) {
    out.content = [{ type: 'paragraph' }];
  }
  return out;
}

function convertBlock(block: SectionNode['content'][number]): PMNode[] {
  switch (block.type) {
    case 'heading':
      return [convertHeading(block)];
    case 'paragraph':
      return [convertParagraph(block)];
    case 'list':
      return [convertList(block)];
    case 'divider':
      return [{ type: 'horizontalRule' }];
    case 'media':
    case 'actions':
    case 'columns':
      // Rendered post-MVP; surface as a placeholder paragraph so the user
      // sees something for now.
      return [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `[${block.type}]` }],
        },
      ];
    default: {
      return [];
    }
  }
}

function convertHeading(node: HeadingNode): PMNode {
  const level = clampLevel(node.attrs.level);
  return {
    type: 'heading',
    attrs: { level },
    content: node.content.map(convertInline),
  };
}

function convertParagraph(node: ParagraphNode): PMNode {
  const content = (node.content ?? []).map(convertInline);
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function convertList(node: ListNode): PMNode {
  const kind = node.attrs.style === 'numbered' ? 'orderedList' : 'bulletList';
  const items = node.content.map((item) => convertListItem(item));
  return { type: kind, content: items };
}

function convertListItem(item: ListItemNode): PMNode {
  return {
    type: 'listItem',
    content: [
      {
        type: 'paragraph',
        content: item.content.map(convertInline),
      },
    ],
  };
}

function convertInline(node: InlineNode): PMNode {
  const text = node.text;
  const marks = node.marks ?? [];
  const out: PMNode = { type: 'text', text };
  const pmMarks: PMNode['marks'] = [];
  for (const m of marks) {
    if (m.type === 'bold' || m.type === 'italic' || m.type === 'code') {
      pmMarks.push({ type: m.type });
    } else if (m.type === 'link') {
      pmMarks.push({
        type: 'link',
        attrs: { href: m.attrs.href, target: m.attrs.target ?? null, rel: m.attrs.rel ?? null },
      });
    } else if (m.type === 'underline' || m.type === 'highlight' || m.type === 'color') {
      // Not in StarterKit; drop for MVP, content survives.
      continue;
    }
  }
  if (pmMarks.length > 0) out.marks = pmMarks;
  return out;
}

function clampLevel(level: number): number {
  if (level < 1) return 1;
  if (level > 6) return 6;
  return level;
}

// StarterKit PM JSON -> rev01 DocumentJSON. Single section.custom wrapping the
// PM-flat blocks. Headings/paragraphs/lists survive verbatim; unknown nodes
// (e.g. blockquote, codeBlock) snapshot as paragraphs.
export function starterKitToRev01(pm: PMNode): DocumentJSON {
  const sectionContent: SectionNode['content'] = [];
  const children = pm.content ?? [];
  for (const node of children) {
    const block = convertPMBlock(node);
    if (block) sectionContent.push(block);
  }
  if (sectionContent.length === 0) {
    sectionContent.push({ type: 'paragraph' });
  }
  const section: SectionNode = {
    type: 'section',
    attrs: { kind: 'custom' },
    content: sectionContent,
  };
  return { type: 'doc', content: [section] };
}

function convertPMBlock(node: PMNode): SectionNode['content'][number] | null {
  switch (node.type) {
    case 'heading': {
      const level = clampLevel(Number(node.attrs?.level ?? 1));
      return {
        type: 'heading',
        attrs: { level: level as HeadingNode['attrs']['level'] },
        content: extractInlineContent(node),
      };
    }
    case 'paragraph':
    case 'blockquote': {
      const content = extractInlineContent(node);
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    case 'bulletList':
    case 'orderedList': {
      const style = node.type === 'orderedList' ? 'numbered' : 'bullet';
      const items: ListItemNode[] = [];
      for (const item of node.content ?? []) {
        const inline: InlineNode[] = [];
        for (const child of item.content ?? []) {
          if (child.type === 'paragraph') inline.push(...extractInlineContent(child));
        }
        items.push({ type: 'listItem', content: inline });
      }
      return items.length > 0 ? { type: 'list', attrs: { style }, content: items } : null;
    }
    case 'horizontalRule':
      return { type: 'divider', attrs: { style: 'line' } };
    case 'codeBlock': {
      const inline = extractInlineContent(node);
      return inline.length > 0 ? { type: 'paragraph', content: inline } : null;
    }
    default:
      return null;
  }
}

function extractInlineContent(node: PMNode): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of node.content ?? []) {
    if (child.type !== 'text' || typeof child.text !== 'string') continue;
    const text: TextNode = { type: 'text', text: child.text };
    const marks = child.marks ?? [];
    const rev01Marks: TextNode['marks'] = [];
    for (const m of marks) {
      switch (m.type) {
        case 'bold':
          rev01Marks.push({ type: 'bold' });
          break;
        case 'italic':
          rev01Marks.push({ type: 'italic' });
          break;
        case 'code':
          rev01Marks.push({ type: 'code' });
          break;
        case 'link': {
          const attrs = (m.attrs ?? {}) as { href?: unknown; target?: unknown; rel?: unknown };
          const href = typeof attrs.href === 'string' ? attrs.href : '';
          const target = typeof attrs.target === 'string' ? attrs.target : undefined;
          const rel = typeof attrs.rel === 'string' ? attrs.rel : undefined;
          const linkAttrs: { href: string; target?: '_self' | '_blank'; rel?: string } = {
            href,
          };
          if (target === '_self' || target === '_blank') linkAttrs.target = target;
          if (rel !== undefined) linkAttrs.rel = rel;
          rev01Marks.push({ type: 'link', attrs: linkAttrs });
          break;
        }
        default:
          break;
      }
    }
    if (rev01Marks.length > 0) text.marks = rev01Marks;
    out.push(text);
  }
  return out;
}

export function hydrateYDoc(doc: DocumentJSON): Y.Doc {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_NAME);
  const pmJSON = rev01ToStarterKit(doc);
  prosemirrorJSONToYXmlFragment(pmSchema, pmJSON, fragment);
  return ydoc;
}

export function serializeYDoc(ydoc: Y.Doc): DocumentJSON {
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_NAME);
  const pmJSON = yXmlFragmentToProsemirrorJSON(fragment) as PMNode;
  return starterKitToRev01(pmJSON);
}

export async function persistSnapshot(
  env: DbEnv,
  pageId: string,
  doc: DocumentJSON,
): Promise<void> {
  const database = db(env);
  await database.update(page).set({ doc, updatedAt: new Date() }).where(eq(page.id, pageId));
}

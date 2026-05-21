// Snapshot helpers — bridge between the page.doc column and the live Y.Doc.
//
// The ProseMirror schema in pm-schema.ts mirrors the rev01 document vocabulary
// (src/document/schema.ts) exactly. Both sides of the wire — this Worker and
// the TipTap editor in the browser — speak the same vocabulary.
//
//   hydrate:   rev01 DocumentJSON -> ProseMirror JSON -> Y.Doc
//   snapshot:  Y.Doc -> ProseMirror JSON -> rev01 DocumentJSON
//
// Round-trip is lossless. Optional attrs are stored as `null` in the
// ProseMirror schema (so y-prosemirror skips writing them to the Y.XmlElement);
// on the way back out, empty/null entries are stripped so the serialized
// DocumentJSON matches the seed shape byte-for-byte after JSON.stringify.
//
// Persistence asserts validateDocument() before writing — invalid output never
// reaches Postgres, the write loudly fails instead.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { db } from '../db/client';
import { page } from '../db/schema';
import type { DocumentJSON } from '../document/schema';
import { validateDocument } from '../document/validate';
import { pmSchema, Y_XML_FRAGMENT_NAME } from './pm-schema';

interface DbEnv {
  DATABASE_URL: string;
}

interface PMNode {
  type: string;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
  attrs?: Record<string, unknown>;
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// rev01 DocumentJSON  ->  ProseMirror JSON.
//
// Names and attr keys already match; just normalise so empty optionals don't
// leak into the schema's parse step (PM fills them in with defaults anyway).
// We also coerce booleans for `newTab` so attrBool parsing isn't needed
// here — the editor produces booleans directly.
// ---------------------------------------------------------------------------

export function docToPmJson(doc: DocumentJSON): PMNode {
  return normaliseForPm(doc) as PMNode;
}

function normaliseForPm(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normaliseForPm);
  if (node === null || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'content') {
      next.content = (v as unknown[]).map(normaliseForPm);
    } else if (k === 'marks') {
      next.marks = (v as unknown[]).map(normaliseForPm);
    } else if (k === 'attrs' && v && typeof v === 'object') {
      next.attrs = { ...(v as Record<string, unknown>) };
    } else {
      next[k] = v;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// ProseMirror JSON  ->  rev01 DocumentJSON.
//
// y-prosemirror writes only non-null attrs to Y.XmlElements; but marks store
// their full attrs map (including nulls) under d.attributes[markType]. We
// strip nulls, drop empty attrs objects, drop empty marks arrays, and drop
// empty content arrays. The output matches the seed JSON shape exactly.
// ---------------------------------------------------------------------------

export function pmJsonToDoc(pm: PMNode): DocumentJSON {
  const out = stripPmNoise(pm) as DocumentJSON;
  return out;
}

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
      const cleaned: PMMark[] = [];
      for (const m of v as PMMark[]) {
        const mark: PMMark = { type: m.type };
        if (m.attrs && typeof m.attrs === 'object') {
          const a: Record<string, unknown> = {};
          for (const [ak, av] of Object.entries(m.attrs)) {
            if (av === null || av === undefined) continue;
            a[ak] = av;
          }
          if (Object.keys(a).length > 0) mark.attrs = a;
        }
        cleaned.push(mark);
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

// ---------------------------------------------------------------------------
// Yjs bindings.
// ---------------------------------------------------------------------------

export function hydrateYDoc(doc: DocumentJSON): Y.Doc {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_NAME);
  const pmJSON = docToPmJson(doc);
  prosemirrorJSONToYXmlFragment(pmSchema, pmJSON, fragment);
  return ydoc;
}

export function serializeYDoc(ydoc: Y.Doc): DocumentJSON {
  const fragment = ydoc.getXmlFragment(Y_XML_FRAGMENT_NAME);
  const pmJSON = yXmlFragmentToProsemirrorJSON(fragment) as PMNode;
  return pmJsonToDoc(pmJSON);
}

// ---------------------------------------------------------------------------
// Persistence.
//
// Validates before writing: a malformed Y.Doc must not poison the page.doc
// column. On invalid output we log and throw — per repo policy, no silent
// degradation.
// ---------------------------------------------------------------------------

export async function persistSnapshot(
  env: DbEnv,
  pageId: string,
  doc: DocumentJSON,
): Promise<void> {
  const result = validateDocument(doc);
  if (!result.valid) {
    const errors = result.errors.join('; ');
    console.error(`persistSnapshot: refusing invalid doc for page ${pageId}: ${errors}`);
    throw new Error(`persistSnapshot: invalid document for page ${pageId}: ${errors}`);
  }
  const database = db(env);
  await database.update(page).set({ doc, updatedAt: new Date() }).where(eq(page.id, pageId));
}

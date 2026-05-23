// src/forms/inbox.ts
//
// Owner-side inbox queries:
//   - `listFormSubmissions` returns newest-first submission rows for a form.
//   - `exportFormSubmissionsCsv` returns CSV bytes for the same range.
//
// Both functions are pure-over-deps so the route layer + the smoke can share
// them. The route layer wraps each call in the standard Clerk → customer →
// site ownership chain so submission contents never leak across Owners.

import { and, desc, eq, lt } from 'drizzle-orm';

import type { FormFieldDef } from '../canvas/elements/form.js';
import type { Db } from '../db/client.js';
import { formSubmission, type FormSubmission } from '../db/schema.js';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;

export interface ListInput {
  siteId: string;
  formElementId: string;
  /** ISO timestamp; only rows with `submittedAt < cursor` are returned. */
  cursor?: string;
  /** Max rows per page. Clamped to [1, MAX_LIST_LIMIT]. */
  limit?: number;
}

export interface ListResult {
  rows: FormSubmission[];
  /** Cursor to pass next call for newest-first pagination. */
  nextCursor: string | null;
}

export async function listFormSubmissions(db: Db, input: ListInput): Promise<ListResult> {
  const limit = clampLimit(input.limit ?? DEFAULT_LIST_LIMIT);
  const conditions = [
    eq(formSubmission.siteId, input.siteId),
    eq(formSubmission.formElementId, input.formElementId),
  ];
  if (input.cursor) {
    const cursorDate = new Date(input.cursor);
    if (!Number.isFinite(cursorDate.getTime())) {
      throw new Error(`[forms/inbox] invalid cursor: ${input.cursor}`);
    }
    conditions.push(lt(formSubmission.submittedAt, cursorDate));
  }
  const rows = await db
    .select()
    .from(formSubmission)
    .where(and(...conditions))
    .orderBy(desc(formSubmission.submittedAt))
    .limit(limit + 1);

  const overflow = rows.length > limit;
  const trimmed = overflow ? rows.slice(0, limit) : rows;
  const lastRow = trimmed[trimmed.length - 1];
  const nextCursor = overflow && lastRow ? lastRow.submittedAt.toISOString() : null;
  return { rows: trimmed, nextCursor };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIST_LIMIT;
  if (limit > MAX_LIST_LIMIT) return MAX_LIST_LIMIT;
  return Math.floor(limit);
}

export interface ExportCsvInput {
  siteId: string;
  formElementId: string;
  /** The form's field definitions, in render order. Drives CSV columns. */
  fields: FormFieldDef[];
}

/**
 * Stream all rows for a form to a CSV string. The header row uses field ids;
 * field-id collisions with the reserved meta columns are namespaced under
 * `payload.<id>` to avoid silent overwrites.
 *
 * The renderer always reads rows oldest-first so spreadsheets that auto-sort
 * by their first column produce a chronological order. Limit is unbounded by
 * design — Owner-side export expects the full history. For a 10k+ form, the
 * caller should still pin a `Content-Disposition` header so the browser
 * streams the response to disk.
 */
export async function exportFormSubmissionsCsv(db: Db, input: ExportCsvInput): Promise<string> {
  const rows = await db
    .select()
    .from(formSubmission)
    .where(
      and(
        eq(formSubmission.siteId, input.siteId),
        eq(formSubmission.formElementId, input.formElementId),
      ),
    )
    .orderBy(formSubmission.submittedAt);

  const fieldIds = input.fields.map((f) => f.id);
  // The header row: meta columns first, then per-field columns. Field id
  // collisions with meta columns prefix-namespace to avoid silent drops.
  const metaColumns = ['submission_id', 'submitted_at', 'page_slug', 'ip_hash', 'user_agent'];
  const fieldColumns = fieldIds.map((id) =>
    metaColumns.includes(id) ? `payload.${id}` : id,
  );
  const header = [...metaColumns, ...fieldColumns];

  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    const payload: Record<string, unknown> = row.payload ?? {};
    const fieldValues = fieldIds.map((id) => stringifyCellValue(payload[id]));
    const line = [
      row.id,
      row.submittedAt.toISOString(),
      row.pageSlug,
      row.ipHash,
      row.userAgent,
      ...fieldValues,
    ]
      .map(csvEscape)
      .join(',');
    lines.push(line);
  }
  // CRLF row terminator matches RFC 4180; spreadsheets that accept LF-only
  // still handle this correctly.
  return lines.join('\r\n') + '\r\n';
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Object / array values get JSON-stringified — preserves the data without
  // expanding into multi-column nesting.
  return JSON.stringify(value);
}

function csvEscape(value: string): string {
  // RFC 4180: wrap in double-quotes if the value contains "," | "\"" | "\n" |
  // "\r"; embedded quotes are doubled.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

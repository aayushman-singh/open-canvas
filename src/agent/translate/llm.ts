// src/agent/translate/llm.ts
//
// Wishlist #24 — Batch translation call.
//
// One LLM call per `translateSite` invocation, regardless of how many strings
// are in the batch. The LLM is asked to translate every string in `batch` and
// return a JSON object of the exact shape:
//
//   { "translations": { "<path>": "<translated>", ... } }
//
// Every input path must appear as a key in `translations`; values must be
// non-empty strings. Anything else is a shape mismatch.
//
// On shape mismatch the call retries up to TWO times (so three attempts
// total). The third failure throws loudly with the last error and the raw
// response text — the caller surfaces this as a 500.
//
// The translator is dependency-injected. Production wires `GeminiTranslator`
// (which talks to Gemini through `llm-gemini`); the smoke wires a stub
// translator that reverses each string deterministically so we don't burn
// real API quota on every test run.

import { GeminiAdapter } from '../llm-gemini.js';
import type { CollectedString } from './collect.js';

export interface TranslateBatchInput {
  from: string;
  to: string;
  batch: CollectedString[];
}

export interface TranslateBatchOutput {
  /** Map from collected path → translated string. */
  translations: Record<string, string>;
}

/**
 * Translator contract. Implementations receive the full batch and return a
 * parallel-shaped map. They MAY internally retry the model call; the outer
 * `translateBatch` wraps every implementation with a shape-validation +
 * retry loop so adapter-level bugs surface as loud failures rather than
 * silent under-translations.
 */
export interface Translator {
  translate(input: TranslateBatchInput): Promise<unknown>;
}

/**
 * Run `translator.translate` and validate the response shape. Retries up to
 * `MAX_ATTEMPTS - 1` extra times on shape mismatch; throws loudly on the
 * final failure. Returns a strongly-shaped `TranslateBatchOutput` on success.
 */
export const MAX_ATTEMPTS = 3;

export async function translateBatch(
  translator: Translator,
  input: TranslateBatchInput,
): Promise<TranslateBatchOutput> {
  // Empty batches short-circuit — there is nothing to translate and the LLM
  // would just be billed for the round trip. Returning early keeps the
  // smoke-with-empty-fixture path fast and deterministic.
  if (input.batch.length === 0) {
    return { translations: {} };
  }

  const errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await translator.translate(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${String(attempt)}: translator threw — ${msg}`);
      continue;
    }
    const validation = validateTranslations(raw, input.batch);
    if (validation.ok) {
      return { translations: validation.translations };
    }
    errors.push(`attempt ${String(attempt)}: ${validation.error}`);
  }

  // Fail loudly — the brief says "fail loudly on 2nd retry failure".
  throw new Error(
    `translateBatch: shape contract violated after ${String(MAX_ATTEMPTS)} attempts:\n${errors.join('\n')}`,
  );
}

interface ValidationOk {
  ok: true;
  translations: Record<string, string>;
}
interface ValidationFail {
  ok: false;
  error: string;
}

function validateTranslations(
  raw: unknown,
  batch: CollectedString[],
): ValidationOk | ValidationFail {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: `response must be a JSON object, got ${describe(raw)}`,
    };
  }
  const rec = raw as Record<string, unknown>;
  const translations = rec.translations;
  if (translations === null || typeof translations !== 'object' || Array.isArray(translations)) {
    return {
      ok: false,
      error: `response.translations must be a JSON object, got ${describe(translations)}`,
    };
  }
  const map = translations as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const entry of batch) {
    const value = map[entry.path];
    if (typeof value !== 'string') {
      return {
        ok: false,
        error: `response.translations missing or non-string for path ${JSON.stringify(entry.path)} (got ${describe(value)})`,
      };
    }
    if (value.length === 0) {
      return {
        ok: false,
        error: `response.translations is empty string for path ${JSON.stringify(entry.path)}`,
      };
    }
    result[entry.path] = value;
  }
  return { ok: true, translations: result };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ---------------------------------------------------------------------------
// Gemini-backed translator (production). The chat adapter is reused: we send
// one user turn carrying the batch as JSON, ask for JSON-only output, and
// parse the model's text response. No tools are supplied — the model is not
// allowed to invoke functions; it must emit the JSON object directly.
// ---------------------------------------------------------------------------

export interface GeminiTranslatorOpts {
  apiKey: string;
  model?: string;
}

export class GeminiTranslator implements Translator {
  private readonly adapter: GeminiAdapter;
  private readonly model: string;

  constructor(opts: GeminiTranslatorOpts) {
    this.adapter = new GeminiAdapter({ apiKey: opts.apiKey });
    this.model = opts.model ?? 'gemini-2.5-pro';
  }

  async translate(input: TranslateBatchInput): Promise<unknown> {
    const systemInstruction = [
      'You are a translation assistant for a website builder. Translate every',
      'input string from the source language to the target language.',
      'Preserve placeholders, numbers, URLs, and punctuation exactly.',
      'Return ONLY a JSON object of the shape {"translations": {"<path>": "<translated>"}}.',
      'Every path from the input batch MUST appear in the output. Values must be non-empty strings.',
      'Do not add commentary, markdown fences, or extra fields.',
    ].join(' ');
    const userPayload = JSON.stringify({
      from: input.from,
      to: input.to,
      batch: input.batch.map((entry) => ({ path: entry.path, original: entry.original })),
    });

    let text = '';
    for await (const chunk of this.adapter.chatWithTools(
      [{ role: 'user', content: userPayload }],
      {
        model: this.model,
        tools: [],
        systemInstruction,
        temperature: 0,
      },
    )) {
      if (chunk.type === 'text') text += chunk.text;
    }

    // The model is asked for raw JSON, but defensively strip a single layer of
    // ```json fences just in case. We do NOT swallow parse errors — the outer
    // retry loop expects a thrown error to count as a shape mismatch attempt.
    const cleaned = stripCodeFence(text.trim());
    try {
      return JSON.parse(cleaned) as unknown;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini response was not valid JSON: ${msg}\n--- raw ---\n${text}\n--- end raw ---`);
    }
  }
}

function stripCodeFence(s: string): string {
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    if (firstNewline >= 0) {
      const withoutOpen = s.slice(firstNewline + 1);
      const closeIdx = withoutOpen.lastIndexOf('```');
      if (closeIdx >= 0) return withoutOpen.slice(0, closeIdx).trim();
    }
  }
  return s;
}

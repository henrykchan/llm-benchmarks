/**
 * Prompt variants and the few-shot pool, keyed by name so they are swappable
 * from the CLI without touching provider code.
 *
 * The few-shot examples come from `data/fewshot.jsonl`, which fetch.ts keeps
 * strictly disjoint from `data/dataset.jsonl`. Drawing them from the scored
 * items would be train/test contamination.
 */
import { readFileSync } from "node:fs";
import {
  CATEGORIES,
  DatasetItemSchema,
  type Category,
  type DatasetItem,
  type ExperimentConfig,
} from "./types.js";

export const PROMPT_VARIANTS = ["terse", "rubric"] as const;
export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

const CATEGORY_LIST = CATEGORIES.join(", ");

/** Minimal instruction: names the categories and nothing else. */
const TERSE = `Classify the GitHub issue into exactly one category: ${CATEGORY_LIST}.`;

/**
 * Adds decision criteria and, critically, tie-breaking rules for the boundaries
 * that actually generate errors on this corpus -- question-vs-bug (a user
 * reporting surprising behaviour they do not understand) and
 * documentation-vs-bug (broken docs infrastructure).
 */
const RUBRIC = `Classify the GitHub issue into exactly one category: ${CATEGORY_LIST}.

Criteria:
- bug: existing behaviour is incorrect. A reproducible defect in shipped code.
- enhancement: proposes new capability, a new argument, or improved behaviour
  that does not exist yet. Includes deprecation proposals and error-message
  improvements.
- documentation: the code is fine but the docs are wrong, unclear, missing, or
  the documentation site itself is broken (dead links, 404s, rendering).
- question: the author is asking how to use the library or seeking to
  understand behaviour, rather than asserting something is wrong.

Tie-breakers:
- If the author is confused and asking why something behaves as it does, prefer
  question over bug, even when they suspect a defect.
- If the complaint is about a doc page, example, or docstring rather than the
  runtime behaviour, prefer documentation over bug.
- If the request is for something that does not exist yet, prefer enhancement
  over bug.

Respond with the category only.`;

const SYSTEM_PROMPTS: Record<PromptVariant, string> = {
  terse: TERSE,
  rubric: RUBRIC,
};

export function systemPrompt(variant: PromptVariant): string {
  return SYSTEM_PROMPTS[variant];
}

let fewShotCache: DatasetItem[] | null = null;

function loadFewShotPool(): DatasetItem[] {
  if (fewShotCache) return fewShotCache;
  const lines = readFileSync("data/fewshot.jsonl", "utf8").trim().split("\n");
  fewShotCache = lines.map((l) => DatasetItemSchema.parse(JSON.parse(l)));
  return fewShotCache;
}

/**
 * Select `n` examples, interleaved by class so a truncated prompt never
 * silently becomes class-skewed. The pool holds 2 per category; n=8 uses all
 * of them, n=3 takes one each from the first three categories.
 *
 * Order is deterministic -- few-shot ordering measurably affects output, so it
 * must not vary between runs or the variance measurement is polluted.
 */
export function selectFewShot(n: number): DatasetItem[] {
  if (n === 0) return [];
  const pool = loadFewShotPool();
  const byCategory = new Map<Category, DatasetItem[]>();
  for (const c of CATEGORIES) byCategory.set(c, []);
  for (const item of pool) byCategory.get(item.label)?.push(item);

  const interleaved: DatasetItem[] = [];
  const depth = Math.max(...[...byCategory.values()].map((v) => v.length));
  for (let d = 0; d < depth; d++) {
    for (const c of CATEGORIES) {
      const item = byCategory.get(c)?.[d];
      if (item) interleaved.push(item);
    }
  }
  if (n > interleaved.length) {
    throw new Error(`Few-shot pool has ${interleaved.length} items, need ${n}.`);
  }
  return interleaved.slice(0, n);
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Few-shot examples as alternating conversational turns rather than as one
 * blob in the system prompt. This matches the shape of the real request, so
 * the model sees examples in the same form as the item it must answer.
 */
export function buildMessages(text: string, config: ExperimentConfig): Turn[] {
  const turns: Turn[] = [];
  for (const ex of selectFewShot(config.fewShotN)) {
    turns.push({ role: "user", content: ex.text });
    turns.push({ role: "assistant", content: ex.label });
  }
  turns.push({ role: "user", content: text });
  return turns;
}

/**
 * Instruction appended when `structured: false`. The unstructured path exists
 * purely so invalid-output rate is a measurable quantity -- with structured
 * output on, it is zero by construction.
 */
export function unstructuredSuffix(): string {
  return `\n\nRespond with exactly one word from: ${CATEGORY_LIST}. No punctuation, no explanation.`;
}

/**
 * Lenient parser for the unstructured path. Deliberately permissive: the point
 * is to measure how often models wrap the answer in prose, not to punish them
 * for a trailing period. Returns null only when no category is identifiable.
 */
export function parseLooseCategory(raw: string): Category | null {
  const lowered = raw.toLowerCase();
  const found = CATEGORIES.filter((c) => new RegExp(`\\b${c}\\b`).test(lowered));
  // Ambiguous when the model names more than one category.
  return found.length === 1 ? found[0]! : null;
}

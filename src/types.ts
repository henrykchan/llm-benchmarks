import { z } from "zod";

/**
 * The category enum is defined exactly once, here. Everything downstream --
 * the Anthropic tool input schema, the Ollama `format` parameter, and runtime
 * validation of every response -- derives from this definition.
 */
export const Category = z.enum([
  "bug",
  "enhancement",
  "documentation",
  "question",
]);
export type Category = z.infer<typeof Category>;

export const CATEGORIES: readonly Category[] = Category.options;

export const ClassificationSchema = z.object({ category: Category });
export type Classification = z.infer<typeof ClassificationSchema>;

/**
 * JSON Schema derived from the Zod schema above -- the same object feeds the
 * Anthropic `classify_issue` tool's `input_schema` and Ollama's `format`
 * parameter, so the category list exists in exactly one place.
 *
 * `reused: "inline"` avoids $ref indirection; neither provider resolves it.
 */
export const CLASSIFICATION_JSON_SCHEMA = z.toJSONSchema(ClassificationSchema, {
  target: "draft-7",
  io: "input",
  reused: "inline",
}) as Record<string, unknown>;

/** One labelled issue from `data/dataset.jsonl`. */
export const DatasetItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  label: Category,
});
export type DatasetItem = z.infer<typeof DatasetItemSchema>;

export interface ClassifyResult {
  label: Category | null; // null on parse failure
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  raw: string;
  error: string | null;
}

export interface ExperimentConfig {
  fewShotN: 0 | 3 | 8;
  structured: boolean;
  promptVariant: "terse" | "rubric";
}

export interface Provider {
  name: string;
  classify(
    text: string,
    model: string,
    config: ExperimentConfig,
  ): Promise<ClassifyResult>;
}

/**
 * The durable record. Every table in `results/` is an aggregation of these
 * lines and nothing else -- aggregation never happens at collection time.
 *
 * Cache token fields are recorded even though prompt caching is deliberately
 * left off (it would contaminate the latency comparison); carrying them keeps
 * that decision visible in the data and reversible later.
 */
export interface RunRecord {
  itemId: string;
  provider: string;
  model: string;
  config: ExperimentConfig;
  runIndex: number;
  predicted: Category | null;
  actual: Category;
  correct: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  error: string | null;
  timestamp: string; // ISO 8601 -- lets report.ts detect thermal drift on local runs
}

/**
 * Deterministic key for a config, used for resumability and for grouping in
 * report.ts. Key order is fixed here rather than relying on JSON.stringify's
 * insertion order, so a record written today matches one written tomorrow.
 */
export function configKey(c: ExperimentConfig): string {
  return `fs${c.fewShotN}|st${c.structured ? 1 : 0}|pv${c.promptVariant}`;
}

/** Uniquely identifies one unit of work, for skip-on-resume. */
export function runKey(
  itemId: string,
  provider: string,
  model: string,
  config: ExperimentConfig,
  runIndex: number,
): string {
  return `${itemId}|${provider}|${model}|${configKey(config)}|${runIndex}`;
}

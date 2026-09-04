/**
 * Aggregation over RunRecords. Pure functions -- all I/O lives in report.ts.
 */
import { CATEGORIES, type Category, type RunRecord } from "../types.js";
import { mean, stdev, wilsonInterval } from "./stats.js";

/**
 * Accuracy of always predicting the most common class. Printed at the top of
 * every table: an accuracy figure without it is uninterpretable. The dataset
 * is balanced 10/class by construction, so this should land at 0.25 -- and if
 * it does not, the dataset drifted and every result below it is suspect.
 */
export function majorityBaseline(actuals: Category[]): { label: Category; accuracy: number } {
  const counts = new Map<Category, number>();
  for (const c of CATEGORIES) counts.set(c, 0);
  for (const a of actuals) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best: Category = CATEGORIES[0]!;
  for (const c of CATEGORIES) if ((counts.get(c) ?? 0) > (counts.get(best) ?? 0)) best = c;
  return {
    label: best,
    accuracy: actuals.length === 0 ? 0 : (counts.get(best) ?? 0) / actuals.length,
  };
}

export interface AccuracySummary {
  /** Mean of the per-run accuracies -- the headline number. */
  mean: number;
  /** Spread across runs: model stochasticity. */
  sd: number;
  /** Wilson 95% interval over all item-predictions: sampling uncertainty. */
  ci: [number, number];
  runs: number[];
  n: number;
}

/**
 * Both uncertainties, deliberately kept distinct. `sd` answers "would I get
 * this number again?"; `ci` answers "does this number generalise beyond these
 * 40 items?". The second is much the larger here, and conflating them is the
 * most common way a small eval oversells itself.
 */
export function accuracySummary(records: RunRecord[]): AccuracySummary {
  const byRun = new Map<number, RunRecord[]>();
  for (const r of records) {
    const list = byRun.get(r.runIndex) ?? [];
    list.push(r);
    byRun.set(r.runIndex, list);
  }
  const runs = [...byRun.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const rs = byRun.get(k)!;
      return rs.filter((r) => r.correct).length / rs.length;
    });
  const correct = records.filter((r) => r.correct).length;
  return {
    mean: mean(runs),
    sd: stdev(runs),
    ci: wilsonInterval(correct, records.length),
    runs,
    n: records.length,
  };
}

export interface ClassAccuracy {
  category: Category;
  accuracy: number;
  support: number;
  ci: [number, number];
}

/**
 * Aggregate accuracy hides a model that nails `bug` and fails completely on
 * `question` -- which is the actual failure shape on this corpus.
 */
export function perClassAccuracy(records: RunRecord[]): ClassAccuracy[] {
  return CATEGORIES.map((category) => {
    const rs = records.filter((r) => r.actual === category);
    const correct = rs.filter((r) => r.correct).length;
    return {
      category,
      accuracy: rs.length === 0 ? 0 : correct / rs.length,
      support: rs.length,
      ci: wilsonInterval(correct, rs.length),
    };
  });
}

/** Rows are true labels, columns predictions; `null` predictions get their own column. */
export interface ConfusionMatrix {
  rows: Category[];
  cols: Array<Category | "invalid">;
  counts: number[][];
}

export function confusionMatrix(records: RunRecord[]): ConfusionMatrix {
  const cols: Array<Category | "invalid"> = [...CATEGORIES, "invalid"];
  const counts = CATEGORIES.map((actual) =>
    cols.map(
      (pred) =>
        records.filter(
          (r) => r.actual === actual && (r.predicted ?? "invalid") === pred,
        ).length,
    ),
  );
  return { rows: [...CATEGORIES], cols, counts };
}

/**
 * Fraction of calls that produced no usable label -- API errors, schema
 * failures, or free-text the parser could not resolve. Reported per
 * configuration because it is the whole point of the `structured: false` arm.
 */
export function invalidOutputRate(records: RunRecord[]): number {
  if (records.length === 0) return 0;
  return records.filter((r) => r.predicted === null).length / records.length;
}

/**
 * One verdict per item, by majority vote across that item's runs. Required for
 * paired model comparison: McNemar needs a single boolean per item, and voting
 * is more stable than arbitrarily taking run 0.
 *
 * Ties (possible at even N) resolve to incorrect -- the conservative choice.
 */
export function itemVerdicts(records: RunRecord[]): Map<string, boolean> {
  const byItem = new Map<string, RunRecord[]>();
  for (const r of records) {
    const list = byItem.get(r.itemId) ?? [];
    list.push(r);
    byItem.set(r.itemId, list);
  }
  const out = new Map<string, boolean>();
  for (const [itemId, rs] of byItem) {
    const correct = rs.filter((r) => r.correct).length;
    out.set(itemId, correct * 2 > rs.length);
  }
  return out;
}

/** Align two models' verdicts on their shared items, preserving order. */
export function pairedVerdicts(
  a: Map<string, boolean>,
  b: Map<string, boolean>,
): { ids: string[]; a: boolean[]; b: boolean[] } {
  const ids = [...a.keys()].filter((id) => b.has(id)).sort();
  return {
    ids,
    a: ids.map((id) => a.get(id)!),
    b: ids.map((id) => b.get(id)!),
  };
}

export function meanLatency(records: RunRecord[]): number {
  return mean(records.map((r) => r.latencyMs));
}

/** Median is the honest central figure for latency; the tail is long. */
export function medianLatency(records: RunRecord[]): number {
  if (records.length === 0) return 0;
  const xs = records.map((r) => r.latencyMs).sort((x, y) => x - y);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

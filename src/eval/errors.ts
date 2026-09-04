/**
 * Dumps every misclassification for manual review -- the input to ANALYSIS.md's
 * failure taxonomy.
 *
 * Groups by item rather than by run, because the interesting question is "which
 * issues are hard, and why", not "which call failed". An item that every model
 * gets wrong the same way is usually a ground-truth problem, not a model
 * problem; that distinction is the point of reading these by hand.
 *
 *   npx tsx src/eval/errors.ts                 # items ranked by error rate
 *   npx tsx src/eval/errors.ts --model qwen2.5:7b
 *   npx tsx src/eval/errors.ts --unanimous     # only items every config missed
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DatasetItemSchema, type Category, type DatasetItem, type RunRecord } from "../types.js";

interface ItemErrors {
  item: DatasetItem;
  total: number;
  wrong: number;
  predictions: Map<Category | "invalid", number>;
  models: Set<string>;
}

function loadItems(): Map<string, DatasetItem> {
  const items = readFileSync("data/dataset.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((l) => DatasetItemSchema.parse(JSON.parse(l)));
  return new Map(items.map((i) => [i.id, i]));
}

function loadRuns(): RunRecord[] {
  return readFileSync("data/runs.jsonl", "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RunRecord];
      } catch {
        return [];
      }
    });
}

function main(): void {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      unanimous: { type: "boolean", default: false },
      full: { type: "boolean", default: false },
    },
  });

  const items = loadItems();
  let runs = loadRuns();
  if (values.model) runs = runs.filter((r) => r.model === values.model);

  const byItem = new Map<string, ItemErrors>();
  for (const r of runs) {
    const item = items.get(r.itemId);
    if (!item) continue;
    const e =
      byItem.get(r.itemId) ??
      ({ item, total: 0, wrong: 0, predictions: new Map(), models: new Set() } satisfies ItemErrors);
    e.total++;
    e.models.add(`${r.provider}/${r.model}`);
    if (!r.correct) {
      e.wrong++;
      const key = r.predicted ?? "invalid";
      e.predictions.set(key, (e.predictions.get(key) ?? 0) + 1);
    }
    byItem.set(r.itemId, e);
  }

  const erred = [...byItem.values()].filter((e) => e.wrong > 0);
  let entries = values.unanimous ? erred.filter((e) => e.wrong === e.total) : erred;
  entries.sort((a, b) => b.wrong / b.total - a.wrong / a.total);

  console.log(
    `${erred.length}/${byItem.size} items misclassified at least once` +
      `${values.model ? ` (model: ${values.model})` : ""}` +
      `${values.unanimous ? `; showing ${entries.length} unanimous failures` : ""}\n`,
  );

  for (const e of entries) {
    const rate = ((e.wrong / e.total) * 100).toFixed(0);
    const preds = [...e.predictions.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p}×${n}`)
      .join(", ");
    console.log("=".repeat(78));
    console.log(`${e.item.id}   truth: ${e.item.label}   wrong ${e.wrong}/${e.total} (${rate}%)`);
    console.log(`predicted: ${preds}`);
    console.log("-".repeat(78));
    console.log(values.full ? e.item.text : e.item.text.slice(0, 600));
    console.log();
  }

  const unanimous = [...byItem.values()].filter((e) => e.wrong === e.total && e.total > 0);
  console.log("=".repeat(78));
  console.log(
    `Summary: ${entries.length} items erred at least once; ` +
      `${unanimous.length} were missed by every run (candidates for wrong ground truth).`,
  );
}

main();

/**
 * Aggregates data/runs.jsonl into terminal tables and results/*.md.
 * Reads only the raw log -- never calls a provider, so tables can always be
 * re-derived from committed evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { configKey, type RunRecord } from "../types.js";
import { accuracySummary, majorityBaseline } from "./scorers.js";
import { selfTest } from "./stats.js";
import { describeModel } from "./pricing.js";
import {
  cfgLabel,
  confusionTable,
  mainTable,
  pairwiseTable,
  perClassTable,
  pct,
  type Group,
} from "./tables.js";

const RUNS_PATH = "data/runs.jsonl";

function loadRuns(): RunRecord[] {
  if (!existsSync(RUNS_PATH)) {
    throw new Error(`${RUNS_PATH} not found -- run src/eval/run.ts first.`);
  }
  return readFileSync(RUNS_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RunRecord];
      } catch {
        return []; // truncated final line after a hard kill
      }
    });
}

function group(records: RunRecord[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of records) {
    const key = `${r.provider}|${r.model}|${configKey(r.config)}`;
    const g = map.get(key) ?? { key, provider: r.provider, model: r.model, config: r.config, records: [] };
    g.records.push(r);
    map.set(key, g);
  }
  return [...map.values()].sort(
    (a, b) => accuracySummary(b.records).mean - accuracySummary(a.records).mean,
  );
}

function buildHeader(records: RunRecord[], groups: Group[], baselineAcc: number, baselineLabel: string): string {
  return (
    `Majority-class baseline: **${pct(baselineAcc)}** (always predict "${baselineLabel}")\n\n` +
    `Dataset: 40 closed issues from \`pandas-dev/pandas\`, balanced 10 per class, ` +
    `template leakage stripped. ${records.length} recorded runs across ${groups.length} configurations.\n\n` +
    `Accuracy is **mean ±sd across runs** (model stochasticity) and **[95% Wilson CI]** ` +
    `over all item-predictions (sampling uncertainty at n=40). The CI is much the larger ` +
    `of the two and is what limits what may be concluded from this table.`
  );
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "self-test": { type: "boolean", default: false },
      out: { type: "string", default: "results/results.md" },
    },
  });

  if (values["self-test"]) {
    const { passed, failed } = selfTest();
    console.log(`stats self-test: ${passed} passed, ${failed.length} failed`);
    for (const f of failed) console.log(`  FAIL ${f}`);
    process.exit(failed.length === 0 ? 0 : 1);
  }

  const records = loadRuns();
  const groups = group(records);
  const base = majorityBaseline(records.map((r) => r.actual));
  const header = buildHeader(records, groups, base.accuracy, base.label);

  const headline = mainTable(groups, base.accuracy);
  const perClass = perClassTable(groups);

  // Pairwise comparison runs across the models sharing the most-populated config.
  const byConfig = new Map<string, Group[]>();
  for (const g of groups) {
    const k = configKey(g.config);
    byConfig.set(k, [...(byConfig.get(k) ?? []), g]);
  }
  const [baselineCfg, baselineGroups] =
    [...byConfig.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];
  const pairwise = baselineGroups.length > 1 ? pairwiseTable(baselineGroups) : null;
  const top = groups[0];

  console.log("\n" + header.replace(/\*\*/g, "") + "\n");
  console.log(headline.term);
  console.log("\nPer-class accuracy\n");
  console.log(perClass.term);
  if (pairwise) {
    console.log(`\nPairwise McNemar p-values (config: ${baselineCfg}); * = p<0.05\n`);
    console.log(pairwise.term);
    for (const n of pairwise.notes) console.log("  " + n.replace(/\*\*/g, ""));
  }
  if (top) {
    console.log(`\nConfusion matrix -- ${top.provider}/${top.model} ${cfgLabel(top.config)}\n`);
    console.log(confusionTable(top).term);
  }

  const md = [
    "# Results",
    "",
    header,
    "",
    "## Headline",
    "",
    headline.md,
    "",
    "## Per-class accuracy",
    "",
    perClass.md,
    "",
    ...(pairwise
      ? [
          `## Pairwise model comparison (McNemar, exact; config \`${baselineCfg}\`)`,
          "",
          "Paired per-item test on majority-vote verdicts. `*` marks p<0.05.",
          "",
          pairwise.md,
          "",
          ...pairwise.notes.map((n) => `- ${n}`),
          "",
        ]
      : []),
    ...(top
      ? [`## Confusion matrix — ${top.provider}/${top.model} (\`${cfgLabel(top.config)}\`)`, "", confusionTable(top).md, ""]
      : []),
    "## Models",
    "",
    ...[...new Set(groups.map((g) => `${g.provider}/${g.model}`))].map((m) => `- ${describeModel(m)}`),
  ].join("\n");

  mkdirSync("results", { recursive: true });
  writeFileSync(values.out!, md + "\n");
  console.log(`\nWrote ${values.out}`);
}

main();

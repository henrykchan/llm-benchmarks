/**
 * Table rendering. Every table is emitted twice from one row set -- once for
 * the terminal via cli-table3, once as markdown for results/ -- so the
 * committed file and the terminal output can never disagree.
 */
import Table from "cli-table3";
import { type RunRecord } from "../types.js";
import {
  accuracySummary,
  confusionMatrix,
  invalidOutputRate,
  itemVerdicts,
  medianLatency,
  pairedVerdicts,
  perClassAccuracy,
} from "./scorers.js";
import { mcnemar } from "./stats.js";
import { costPer1k } from "./pricing.js";

export interface Group {
  key: string;
  provider: string;
  model: string;
  config: RunRecord["config"];
  records: RunRecord[];
}

export interface Rendered {
  term: string;
  md: string;
}

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export const cfgLabel = (c: RunRecord["config"]): string =>
  `fs${c.fewShotN} ${c.structured ? "struct" : "text"} ${c.promptVariant}`;

function render(head: string[], rows: string[][]): Rendered {
  const t = new Table({ head });
  for (const r of rows) t.push(r);
  return {
    term: t.toString(),
    md: [
      `| ${head.join(" | ")} |`,
      `|${head.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n"),
  };
}

export function mainTable(groups: Group[], baseline: number): Rendered {
  const head = [
    "provider/model",
    "config",
    "accuracy ±sd [95% CI]",
    "vs base",
    "invalid",
    "med latency",
    "$/1k",
  ];
  const rows = groups.map((g) => {
    const a = accuracySummary(g.records);
    const inTok = g.records.reduce((s, r) => s + r.inputTokens, 0) / g.records.length;
    const outTok = g.records.reduce((s, r) => s + r.outputTokens, 0) / g.records.length;
    const cost = costPer1k(g.provider, g.model, inTok, outTok);
    return [
      `${g.provider}/${g.model}`,
      cfgLabel(g.config),
      `${pct(a.mean)} ±${(a.sd * 100).toFixed(1)} [${pct(a.ci[0])}–${pct(a.ci[1])}]`,
      `${a.mean > baseline ? "+" : ""}${((a.mean - baseline) * 100).toFixed(1)}pp`,
      pct(invalidOutputRate(g.records)),
      `${Math.round(medianLatency(g.records))}ms`,
      cost === null ? "$0.00" : `$${cost.toFixed(2)}`,
    ];
  });
  return render(head, rows);
}

export function perClassTable(groups: Group[]): Rendered {
  const head = ["provider/model", "config", "bug", "enhancement", "documentation", "question"];
  const rows = groups.map((g) => [
    `${g.provider}/${g.model}`,
    cfgLabel(g.config),
    ...perClassAccuracy(g.records).map((c) => pct(c.accuracy)),
  ]);
  return render(head, rows);
}

export function confusionTable(g: Group): Rendered {
  const m = confusionMatrix(g.records);
  const head = ["actual \\ predicted", ...m.cols];
  const rows = m.rows.map((row, i) => [row, ...m.counts[i]!.map(String)]);
  return render(head, rows);
}

export interface Pairwise extends Rendered {
  notes: string[];
}

/**
 * Pairwise McNemar across models sharing a config. This table is what licenses
 * any "X beats Y" claim; without it a few points of gap on 40 items is
 * indistinguishable from noise.
 */
export function pairwiseTable(groups: Group[]): Pairwise {
  const verdicts = groups.map((g) => ({ name: g.model, v: itemVerdicts(g.records) }));
  const head = ["", ...verdicts.map((v) => v.name)];

  const rows = verdicts.map((a) => [
    a.name,
    ...verdicts.map((b) => {
      if (a.name === b.name) return "—";
      const p = pairedVerdicts(a.v, b.v);
      const r = mcnemar(p.a, p.b);
      return r.pValue < 0.05 ? `${r.pValue.toFixed(3)}*` : r.pValue.toFixed(3);
    }),
  ]);

  const notes: string[] = [];
  for (let i = 0; i < verdicts.length; i++) {
    for (let j = i + 1; j < verdicts.length; j++) {
      const a = verdicts[i]!;
      const b = verdicts[j]!;
      const p = pairedVerdicts(a.v, b.v);
      const r = mcnemar(p.a, p.b);
      notes.push(
        r.pValue < 0.05
          ? `**${a.name} vs ${b.name}**: distinguishable (b=${r.b}, c=${r.c}, p=${r.pValue.toFixed(4)})`
          : `${a.name} vs ${b.name}: NOT distinguishable at n=40 (b=${r.b}, c=${r.c}, p=${r.pValue.toFixed(4)})`,
      );
    }
  }
  return { ...render(head, rows), notes };
}

# LLM Evaluation Harness

Benchmarks local (Ollama) and hosted (Anthropic) models on a single classification
task — routing a GitHub issue to `bug` / `enhancement` / `documentation` / `question` —
with the statistical hygiene the comparison actually requires.

The classifier is the excuse. The benchmark is the product.

**1,680 runs · 6 models · 14 configurations · 40 labelled issues · 3 runs each**

## Results

Majority-class baseline: **25.0%**. Accuracy is `mean ±sd across runs [95% Wilson CI]`.
The CI is the larger uncertainty and is what limits every claim below.

| provider/model | config | accuracy ±sd [95% CI] | invalid | med latency | $/1k |
|---|---|---|---|---|---|
| claude-haiku-4-5 | fs3 struct **rubric** | **79.2% ±1.4 [71.1–85.5]** | 0.0% | 737ms | $2.53 |
| claude-opus-5 | fs3 struct terse | 75.0% ±0.0 [66.6–81.9] | 0.0% | 1471ms | $13.39 |
| claude-sonnet-5 | fs3 struct terse | 74.2% ±1.4 [65.7–81.2] | 0.0% | 1448ms | $5.49 |
| claude-haiku-4-5 | fs8 struct terse | 72.5% ±0.0 [63.9–79.7] | 0.0% | 740ms | $3.84 |
| claude-haiku-4-5 | fs3 **text** terse | 70.0% ±2.5 [61.3–77.5] | 0.0% | 716ms | $1.51 |
| qwen2.5:7b | fs3 struct rubric | 68.3% ±1.4 [59.6–76.0] | 0.0% | 4347ms | $0.00 |
| claude-haiku-4-5 | fs3 struct terse | 68.3% ±2.9 [59.6–76.0] | 0.0% | 798ms | $2.31 |
| qwen2.5:7b | fs8 struct terse | 67.5% ±0.0 [58.7–75.2] | 0.0% | 4887ms | $0.00 |
| claude-haiku-4-5 | fs0 struct terse | 64.2% ±1.4 [55.3–72.2] | 0.0% | 772ms | $1.14 |
| llama3.1:8b | fs3 struct terse | 62.5% ±4.3 [53.6–70.6] | 0.0% | 4192ms | $0.00 |
| llama3.2:3b | fs3 struct terse | 61.7% ±3.8 [52.7–69.9] | 0.0% | 1321ms | $0.00 |
| qwen2.5:7b | fs3 text terse | 59.2% ±1.4 [50.2–67.5] | 0.0% | 3607ms | $0.00 |
| qwen2.5:7b | fs0 struct terse | 58.3% ±2.9 [49.4–66.8] | 0.0% | 1359ms | $0.00 |
| qwen2.5:7b | fs3 struct terse | 58.3% ±1.4 [49.4–66.8] | 0.0% | 3228ms | $0.00 |

Full tables, per-class breakdown, pairwise McNemar matrix and confusion matrices:
[`results/results.md`](results/results.md). Findings and failure taxonomy:
[`ANALYSIS.md`](ANALYSIS.md).

## Four findings

**1. The labels are the bottleneck, not the models.** Every model scores ~100% on
`bug` and ~40% on `question`. Opus 5 and Sonnet 5 produced *identical* predictions on
all 40 items (McNemar b=0, c=0). `question` items are **46% of all 553 errors**.
Reading every misclassification by hand: **8 of 26 erring items have a wrong or highly
defensible ground-truth label** — pandas applies `Usage Question` based on how a
maintainer *resolved* an issue, not on what the text says, and the text was written by
someone who sincerely thought they had found a bug. That information is not in the
input, so no model can recover it.

**2. A rubric on the cheapest model matched the flagship at 1/5 the cost.**
Haiku 4.5 + rubric (79.2%, $2.53/1k) disagreed with Opus 5 (75.0%, $13.39/1k) on one
item out of forty — not distinguishable (p=1.000). Writing down what separates a
`question` from a `bug` was worth more than a 5× price increase.

**3. Local model size did nothing.** 3B → 7B → 8B: all pairwise comparisons p=1.000.
No size cliff below 8B. The 3B is 3× faster. The gap that *is* real is local → hosted
(Opus/Sonnet vs the 7B/8B, p=0.031–0.039).

**4. Structured output bought nothing — 0 invalid outputs in 1,680 runs.** Free-text
Haiku matched structured Haiku (p=1.000) while costing **35% less**, since the tool
schema is pure input-token overhead. Even `llama3.2:3b` never failed to emit a bare
category word.

## Why the statistics are the point

At n=40 the 95% interval on ~75% accuracy is roughly ±9pp, so a 4pp gap means nothing.
Because every model sees identical items, model comparison uses a **paired exact
McNemar test** rather than comparing independent proportions.

This matters: **19 of 23 pairwise comparisons in this study are not statistically
distinguishable.** A naive write-up would have confidently reported "rubric prompting
gives +10pp" — the paired test says p=0.25.

The exact test has a hard floor of **6 discordant pairs in one direction** to reach
p<0.05. Simulated power to detect the observed rubric effect at n=40 was **0.08**;
n=120 would be needed for 90% power. That is stated plainly in `ANALYSIS.md` rather
than buried — the honest conclusion of this benchmark is that it is underpowered, and
knowing by how much is the useful part.

## Design decisions

- **Few-shot contamination control.** Examples live in `data/fewshot.jsonl`, disjoint
  from the scored set by construction and verified at fetch time. Drawing them from the
  eval set would silently inflate 3-shot and 8-shot results.
- **Leakage stripping.** pandas stamps the answer into its issues (`BUG:` prefixes,
  `Location of the documentation` template headings, `- [x] I have confirmed this bug`
  checkboxes). All removed; a regex classifier would otherwise score ~100%. Category
  words in the author's *own prose* are deliberately kept — a real classifier sees
  those. Residual rate is measured and reported at fetch time, not assumed.
- **Two uncertainties, never conflated.** `sd` across runs is model stochasticity;
  the Wilson CI is sampling error. The second is much larger here.
- **Raw records only.** Every run appends one line to `data/runs.jsonl`; all
  aggregation happens in `report.ts`. Nothing is aggregated at collection time, so
  every table is reproducible from committed evidence.
- **Prompt caching deliberately off.** It would have halved hosted spend but cached
  calls return faster, and latency is a reported axis.
- **`effort` applied per model capability.** Haiku 4.5 predates
  `output_config.effort` and returns 400 on it; a single-item check caught this before
  any volume spend.

## Reproducing

Requires Node 20+, [Ollama](https://ollama.com), and `ANTHROPIC_API_KEY` for the
hosted half. Local-only runs need no key.

```bash
npm install
ollama pull llama3.2:3b && ollama pull qwen2.5:7b && ollama pull llama3.1:8b

npx tsx src/eval/fetch.ts          # rebuild dataset (prints samples for manual review)
npx tsx src/eval/report.ts --self-test   # verify statistics (11 reference checks)

npx tsx src/eval/run.ts --matrix experiments-local.json --runs 3
npx tsx src/eval/run.ts --matrix experiments-hosted.json --runs 3
npx tsx src/eval/report.ts         # re-render tables from runs.jsonl
npx tsx src/eval/errors.ts --unanimous   # items every run missed
```

Runs are resumable: `run.ts` skips any
`(item, provider, model, config, runIndex)` already in `runs.jsonl`, so an interrupted
sweep continues where it stopped. Ollama defaults to concurrency 1 (concurrent local
inference thrashes a 16GB machine and would corrupt the latency numbers); hosted
defaults to 4.

## Layout

```
src/
  types.ts              Category enum (Zod) -- single source of truth for both providers
  prompts.ts            terse/rubric variants + held-out few-shot pool
  providers/            anthropic.ts, ollama.ts, index.ts (registry)
  eval/
    fetch.ts, clean.ts  GitHub fetch + leakage removal
    stats.ts            Wilson intervals, exact McNemar, --self-test
    scorers.ts          accuracy, per-class, confusion, baseline, invalid rate
    run.ts, cli.ts      experiment runner (resumable, bounded concurrency)
    report.ts, tables.ts, pricing.ts
    errors.ts           misclassification dump for manual review
data/dataset.jsonl      40 issues, 10 per class
data/fewshot.jsonl      8 held-out examples, disjoint
data/runs.jsonl         1,680 raw records -- the evidence
results/results.md      generated tables
```

Adding a provider requires zero changes to `run.ts` — it only ever calls
`Provider.classify` through the registry.

## Limitations

Single repository (pandas), n=40, one annotator. The `Usage Question` pathology is
plausibly specific to pandas' triage culture. Local latency is measured on a fanless
MacBook Air and drifts upward under sustained load; timestamps are recorded so this is
auditable. See `ANALYSIS.md` for the full list.

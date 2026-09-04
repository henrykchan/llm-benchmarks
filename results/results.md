# Results

Majority-class baseline: **25.0%** (always predict "bug")

Dataset: 40 closed issues from `pandas-dev/pandas`, balanced 10 per class, template leakage stripped. 1680 recorded runs across 14 configurations.

Accuracy is **mean ±sd across runs** (model stochasticity) and **[95% Wilson CI]** over all item-predictions (sampling uncertainty at n=40). The CI is much the larger of the two and is what limits what may be concluded from this table.

## Headline

| provider/model | config | accuracy ±sd [95% CI] | vs base | invalid | med latency | $/1k |
|---|---|---|---|---|---|---|
| anthropic/claude-haiku-4-5 | fs3 struct rubric | 79.2% ±1.4 [71.1%–85.5%] | +54.2pp | 0.0% | 737ms | $2.53 |
| anthropic/claude-opus-5 | fs3 struct terse | 75.0% ±0.0 [66.6%–81.9%] | +50.0pp | 0.0% | 1471ms | $13.39 |
| anthropic/claude-sonnet-5 | fs3 struct terse | 74.2% ±1.4 [65.7%–81.2%] | +49.2pp | 0.0% | 1448ms | $5.49 |
| anthropic/claude-haiku-4-5 | fs8 struct terse | 72.5% ±0.0 [63.9%–79.7%] | +47.5pp | 0.0% | 740ms | $3.84 |
| anthropic/claude-haiku-4-5 | fs3 text terse | 70.0% ±2.5 [61.3%–77.5%] | +45.0pp | 0.0% | 716ms | $1.51 |
| ollama/qwen2.5:7b | fs3 struct rubric | 68.3% ±1.4 [59.6%–76.0%] | +43.3pp | 0.0% | 4347ms | $0.00 |
| anthropic/claude-haiku-4-5 | fs3 struct terse | 68.3% ±2.9 [59.6%–76.0%] | +43.3pp | 0.0% | 798ms | $2.31 |
| ollama/qwen2.5:7b | fs8 struct terse | 67.5% ±0.0 [58.7%–75.2%] | +42.5pp | 0.0% | 4887ms | $0.00 |
| anthropic/claude-haiku-4-5 | fs0 struct terse | 64.2% ±1.4 [55.3%–72.2%] | +39.2pp | 0.0% | 772ms | $1.14 |
| ollama/llama3.1:8b | fs3 struct terse | 62.5% ±4.3 [53.6%–70.6%] | +37.5pp | 0.0% | 4192ms | $0.00 |
| ollama/llama3.2:3b | fs3 struct terse | 61.7% ±3.8 [52.7%–69.9%] | +36.7pp | 0.0% | 1321ms | $0.00 |
| ollama/qwen2.5:7b | fs3 text terse | 59.2% ±1.4 [50.2%–67.5%] | +34.2pp | 0.0% | 3607ms | $0.00 |
| ollama/qwen2.5:7b | fs0 struct terse | 58.3% ±2.9 [49.4%–66.8%] | +33.3pp | 0.0% | 1359ms | $0.00 |
| ollama/qwen2.5:7b | fs3 struct terse | 58.3% ±1.4 [49.4%–66.8%] | +33.3pp | 0.0% | 3228ms | $0.00 |

## Per-class accuracy

| provider/model | config | bug | enhancement | documentation | question |
|---|---|---|---|---|---|
| anthropic/claude-haiku-4-5 | fs3 struct rubric | 100.0% | 83.3% | 90.0% | 43.3% |
| anthropic/claude-opus-5 | fs3 struct terse | 100.0% | 70.0% | 90.0% | 40.0% |
| anthropic/claude-sonnet-5 | fs3 struct terse | 100.0% | 70.0% | 86.7% | 40.0% |
| anthropic/claude-haiku-4-5 | fs8 struct terse | 100.0% | 73.3% | 76.7% | 40.0% |
| anthropic/claude-haiku-4-5 | fs3 text terse | 100.0% | 70.0% | 70.0% | 40.0% |
| ollama/qwen2.5:7b | fs3 struct rubric | 90.0% | 80.0% | 66.7% | 36.7% |
| anthropic/claude-haiku-4-5 | fs3 struct terse | 100.0% | 70.0% | 63.3% | 40.0% |
| ollama/qwen2.5:7b | fs8 struct terse | 90.0% | 86.7% | 60.0% | 33.3% |
| anthropic/claude-haiku-4-5 | fs0 struct terse | 100.0% | 73.3% | 50.0% | 33.3% |
| ollama/llama3.1:8b | fs3 struct terse | 100.0% | 53.3% | 70.0% | 26.7% |
| ollama/llama3.2:3b | fs3 struct terse | 100.0% | 60.0% | 36.7% | 50.0% |
| ollama/qwen2.5:7b | fs3 text terse | 100.0% | 60.0% | 36.7% | 40.0% |
| ollama/qwen2.5:7b | fs0 struct terse | 100.0% | 63.3% | 26.7% | 43.3% |
| ollama/qwen2.5:7b | fs3 struct terse | 96.7% | 80.0% | 16.7% | 40.0% |

## Pairwise model comparison (McNemar, exact; config `fs3|st1|pvterse`)

Paired per-item test on majority-vote verdicts. `*` marks p<0.05.

|  | claude-opus-5 | claude-sonnet-5 | claude-haiku-4-5 | llama3.1:8b | llama3.2:3b | qwen2.5:7b |
|---|---|---|---|---|---|---|
| claude-opus-5 | — | 1.000 | 0.625 | 0.031* | 0.109 | 0.039* |
| claude-sonnet-5 | 1.000 | — | 0.625 | 0.031* | 0.109 | 0.039* |
| claude-haiku-4-5 | 0.625 | 0.625 | — | 0.219 | 0.344 | 0.180 |
| llama3.1:8b | 0.031* | 0.031* | 0.219 | — | 1.000 | 1.000 |
| llama3.2:3b | 0.109 | 0.109 | 0.344 | 1.000 | — | 1.000 |
| qwen2.5:7b | 0.039* | 0.039* | 0.180 | 1.000 | 1.000 | — |

- claude-opus-5 vs claude-sonnet-5: NOT distinguishable at n=40 (b=0, c=0, p=1.0000)
- claude-opus-5 vs claude-haiku-4-5: NOT distinguishable at n=40 (b=3, c=1, p=0.6250)
- **claude-opus-5 vs llama3.1:8b**: distinguishable (b=6, c=0, p=0.0313)
- claude-opus-5 vs llama3.2:3b: NOT distinguishable at n=40 (b=8, c=2, p=0.1094)
- **claude-opus-5 vs qwen2.5:7b**: distinguishable (b=8, c=1, p=0.0391)
- claude-sonnet-5 vs claude-haiku-4-5: NOT distinguishable at n=40 (b=3, c=1, p=0.6250)
- **claude-sonnet-5 vs llama3.1:8b**: distinguishable (b=6, c=0, p=0.0313)
- claude-sonnet-5 vs llama3.2:3b: NOT distinguishable at n=40 (b=8, c=2, p=0.1094)
- **claude-sonnet-5 vs qwen2.5:7b**: distinguishable (b=8, c=1, p=0.0391)
- claude-haiku-4-5 vs llama3.1:8b: NOT distinguishable at n=40 (b=5, c=1, p=0.2188)
- claude-haiku-4-5 vs llama3.2:3b: NOT distinguishable at n=40 (b=7, c=3, p=0.3438)
- claude-haiku-4-5 vs qwen2.5:7b: NOT distinguishable at n=40 (b=7, c=2, p=0.1797)
- llama3.1:8b vs llama3.2:3b: NOT distinguishable at n=40 (b=4, c=4, p=1.0000)
- llama3.1:8b vs qwen2.5:7b: NOT distinguishable at n=40 (b=6, c=5, p=1.0000)
- llama3.2:3b vs qwen2.5:7b: NOT distinguishable at n=40 (b=4, c=3, p=1.0000)

## Confusion matrix — anthropic/claude-haiku-4-5 (`fs3 struct rubric`)

| actual \ predicted | bug | enhancement | documentation | question | invalid |
|---|---|---|---|---|---|
| bug | 30 | 0 | 0 | 0 | 0 |
| enhancement | 4 | 25 | 0 | 1 | 0 |
| documentation | 3 | 0 | 27 | 0 | 0 |
| question | 17 | 0 | 0 | 13 | 0 |

## Models

- `anthropic/claude-haiku-4-5` — Claude Haiku 4.5 (hosted, small), $1/$5 per MTok
- `anthropic/claude-opus-5` — Claude Opus 5 (hosted, large), $5/$25 per MTok
- `anthropic/claude-sonnet-5` — Claude Sonnet 5 (hosted, mid), $2/$10 per MTok
- `ollama/qwen2.5:7b` — Qwen 2.5 7B (local, ~4.7GB), $0 API cost
- `ollama/llama3.1:8b` — Llama 3.1 8B (local, ~4.9GB), $0 API cost
- `ollama/llama3.2:3b` — Llama 3.2 3B (local, ~2.0GB), $0 API cost

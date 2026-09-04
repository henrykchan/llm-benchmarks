# Analysis

1,680 runs. 6 models, 14 configurations, 40 issues, 3 runs each.

## The headline

**On this task the models are not the bottleneck — the labels are.** Every model
from a 3B running on a laptop to Claude Opus 5 scores ~100% on `bug` and ~40% on
`question`, and `question` items account for **46% of all 553 errors**. Opus 5 and
Sonnet 5 produced *identical* predictions on all 40 items (McNemar b=0, c=0). That is
not two models being similarly good; that is two models hitting the same wall.

The wall is that pandas' `Usage Question` label does not describe the text of an issue.
It describes how a maintainer *resolved* it.

---

## What surprised me

### 1. A better prompt on the cheapest model matched the flagship

| config | accuracy | $/1k |
|---|---|---|
| `claude-haiku-4-5` + rubric | 79.2% [71.1–85.5] | $2.53 |
| `claude-opus-5` + terse | 75.0% [66.6–81.9] | $13.39 |

Haiku with a rubric prompt disagreed with Opus on **one item out of forty**
(b=1, c=0, p=1.000). I cannot claim it *beats* Opus — the 4.2pp gap is noise. But
"indistinguishable from the flagship at one fifth the cost" is a supported claim, and
it is the practical one. The rubric cost nothing but the twenty minutes it took to
write down what distinguishes a `question` from a `bug`.

### 2. Local model size did nothing

3B → 7B → 8B moved accuracy from 61.7% → 58.3% → 62.5%, and **every** pairwise
comparison among them is p=1.000. There is no size cliff between 3B and 8B on this
task. The 3B is also 3× faster (1,321ms vs 4,192ms median). If you are running
locally, the 8B is buying you nothing here.

The gap that *is* real is local → hosted: Opus and Sonnet are distinguishable from
both `qwen2.5:7b` (p=0.039) and `llama3.1:8b` (p=0.031).

### 3. Structured output changed nothing, because nothing ever failed

**Zero invalid outputs in 1,680 runs.** Not one. The free-text arm existed specifically
to make invalid-output-rate measurable, and the answer is that every model — including
`llama3.2:3b` — reliably emitted a bare category word when asked. Free-text Haiku
(70.0%) was statistically identical to structured Haiku (68.3%, b=1/c=1, p=1.000)
while costing **35% less** ($1.51 vs $2.31 per 1k), because the tool schema is pure
input-token overhead.

The received wisdom that you need constrained decoding to get parseable output from
small local models did not survive contact with the measurement. For a
single-token-answer task, it is a cost with no benefit.

### 4. Few-shot has a threshold, not a gradient

`qwen2.5:7b` scored **exactly 58.3% at both 0-shot and 3-shot**, then 67.5% at 8-shot.
Haiku went 64.2% → 68.3% → 72.5%. Three examples across four classes is under one
example per class, which is apparently worse than useless — it anchors without
teaching. None of these deltas reach significance at n=40 (see below).

---

## Failure taxonomy

26 of 40 items were misclassified at least once. Reading all of them:

| category | items | share |
|---|---|---|
| Ground-truth label wrong or highly defensible | 8 | 31% |
| Genuinely ambiguous category boundary | 12 | 46% |
| Genuine model error | 6 | 23% |
| Output-format failure | **0** | **0%** |

### Ground truth wrong — the model was right (8 items)

**This is the important number.** Seven of these are labelled `Usage Question` but
read as unambiguous defect reports:

- **#44825** — title is literally *"rolling with method='table' ... gets wrong result"*,
  and the body has sections headed "right result" and "wrong result". Every one of 42
  runs said `bug`. Every one of them was right.
- **#52122** — *"When used in `loc` this will crash python."* A crash. 41/42 said `bug`.
- **#43631** — demonstrates `.equals()` returning False for values that print
  identically, plus a `TypeError`. 41/42 said `bug`.
- **#47291** — *"I would have expected that both ... would return the same values.
  Instead ..."* 42/42 said `bug`.
- **#66407** — an option silently not respected inside `option_context`. Labelled
  `Docs`; 42/42 said `bug`.
- **#59226** — labelled `Enhancement`, but the text is *"Does this need to be fixed?"*
  and *"is it worth fixing"*. 20 runs said `question`. The label is wrong; the models
  were reading correctly.

The mechanism is that `Usage Question` is applied **after triage**, once a maintainer
has determined the user misunderstood the library. But the issue *text* was written by
someone who sincerely believed they had found a bug — so it reads exactly like a bug
report, because from the author's point of view it was one. The information that would
separate the two classes does not exist in the input. It exists only in the maintainer's
reply.

No model can recover it. That is why Opus 5 and Sonnet 5 made identical predictions,
and why `question` accuracy sits near 40% regardless of how much money you spend.

### Genuinely ambiguous (12 items)

Mostly `documentation` vs `bug` (broken doc-site infrastructure — #64223's 404ing
source links are a real defect *in* the docs) and `enhancement` vs `bug` (#60685: is a
confusing error message a defect or a missing feature?). Reasonable humans disagree
here. I do not think these are model failures.

### Genuine model error (6 items)

Low-frequency, mostly single-run flukes: #66348 (`bug` → `enhancement`, 7/42),
#58667 (4/42), #50091 (1/42). This is the only bucket that would shrink if you bought
a better model, and it is the smallest one.

---

## What n=40 can and cannot support

This is the project's real limitation and I want to state it precisely rather than
bury it.

**19 of 23 pairwise comparisons in this study are not statistically distinguishable.**
Only four clear significance, all of them frontier-hosted vs 7B/8B-local.

The exact McNemar test has a hard floor: **you need at least 6 discordant pairs, all
in the same direction, to reach p<0.05.** With b+c=5 the best achievable p is 0.0625.
No amount of cleverness gets under 0.05 with fewer disagreements.

Simulating power against the effects I actually observed:

| comparison | n=40 | n=80 | n=120 | n=400 |
|---|---|---|---|---|
| rubric effect (observed b=3, c=0) | **0.08** | 0.56 | 0.90 | 1.00 |
| a subtler ~6pp gap | **0.06** | — | 0.27 (n=100) | 0.88 |

**My power to detect the rubric effect at n=40 was 8%.** The study was almost designed
not to find it. Every "not distinguishable" result in this report is therefore weak
evidence of absence — with one exception: Opus vs Sonnet at b=0, c=0 is a genuine zero,
not an underpowered null.

I would need **n=120** to properly test the prompt-variant finding and **n≈400** for
the model-comparison differences. That is the single change I would make.

Reporting a bare "rubric gives +10pp" from this data would have been wrong, and it is
exactly what I would have concluded without the paired test.

---

## What I would do differently

1. **n=120 minimum**, stratified. Everything above is downstream of this.
2. **Drop `question`, or redefine it.** It is not a property of the text. A cleaner
   task is 3-way `bug`/`enhancement`/`documentation`, which would likely run near
   ceiling — which is itself an argument for choosing a harder task.
3. **Get a second annotator.** I claim 8 labels are wrong, but that is *my* judgement
   against the maintainer's. Inter-annotator agreement would turn an assertion into a
   measurement.
4. **Drop structured output.** It costs 35% more input tokens and buys nothing
   measurable at a 0.0% failure rate.
5. **Measure latency on a machine with a fan.** See the caveat below.

## Caveats

- **Thermal throttling.** Local runs were sequential on a fanless 16GB MacBook Air.
  Sustained inference throttles, so late-run local latencies drift upward for reasons
  unrelated to the model. Every record carries an ISO timestamp so this is auditable,
  but local latency should be read as indicative, not precise. Hosted latencies are
  unaffected.
- **Prompt caching deliberately off.** It would have roughly halved hosted spend, but
  cached calls return faster and latency is a reported axis. Clean latency was worth
  more than ~$2.
- **Cost figures are computed from measured token counts**, not estimates. Opus and
  Sonnet tokenize the same text ~1.3× heavier than Haiku, which is included.
- **Single repository.** Everything here is pandas-specific. The `Usage Question`
  pathology in particular is a property of pandas' triage culture and may not
  generalise.
- **Few-shot examples are held out** in `data/fewshot.jsonl`, disjoint from the scored
  set by construction and verified at fetch time.

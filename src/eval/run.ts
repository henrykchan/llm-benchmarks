/**
 * Experiment runner. Collects raw RunRecords into data/runs.jsonl and does
 * nothing else -- no aggregation at collection time, so every table in
 * results/ can be re-derived from the log alone.
 *
 * Adding a provider requires zero changes to this file: it resolves providers
 * through the registry and only ever calls `Provider.classify`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { getProvider } from "../providers/index.js";
import {
  DatasetItemSchema,
  runKey,
  type DatasetItem,
  type ExperimentConfig,
  type RunRecord,
} from "../types.js";
import { parseInvocation, type Experiment } from "./cli.js";

const RUNS_PATH = "data/runs.jsonl";
const DATASET_PATH = "data/dataset.jsonl";

interface Job {
  item: DatasetItem;
  provider: string;
  model: string;
  config: ExperimentConfig;
  runIndex: number;
}

function loadDataset(): DatasetItem[] {
  return readFileSync(DATASET_PATH, "utf8")
    .trim()
    .split("\n")
    .map((l) => DatasetItemSchema.parse(JSON.parse(l)));
}

/** Keys of work already on disk, so an interrupted run resumes exactly. */
function completedKeys(): Set<string> {
  if (!existsSync(RUNS_PATH)) return new Set();
  const keys = new Set<string>();
  for (const line of readFileSync(RUNS_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RunRecord;
      keys.add(runKey(r.itemId, r.provider, r.model, r.config, r.runIndex));
    } catch {
      // A truncated final line is expected after a hard kill; skip it.
    }
  }
  return keys;
}

/**
 * Bounded worker pool. Ollama defaults to 1 -- concurrent local inference on
 * 16GB thrashes, and would make the latency numbers meaningless anyway.
 */
async function pool<T>(items: T[], limit: number, worker: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]!);
  });
  await Promise.all(runners);
}

async function execute(job: Job): Promise<RunRecord> {
  const res = await getProvider(job.provider).classify(job.item.text, job.model, job.config);
  return {
    itemId: job.item.id,
    provider: job.provider,
    model: job.model,
    config: job.config,
    runIndex: job.runIndex,
    predicted: res.label,
    actual: job.item.label,
    correct: res.label === job.item.label,
    latencyMs: res.latencyMs,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    error: res.error,
    timestamp: new Date().toISOString(),
  };
}

function pendingJobs(exp: Experiment, dataset: DatasetItem[], done: Set<string>): Job[] {
  const jobs: Job[] = [];
  for (let runIndex = 0; runIndex < exp.runs; runIndex++) {
    for (const item of dataset) {
      if (done.has(runKey(item.id, exp.provider, exp.model, exp.config, runIndex))) continue;
      jobs.push({ item, provider: exp.provider, model: exp.model, config: exp.config, runIndex });
    }
  }
  return jobs;
}

async function runExperiments(experiments: Experiment[], concurrency?: number): Promise<void> {
  const dataset = loadDataset();
  const done = completedKeys();
  mkdirSync("data", { recursive: true });

  for (const exp of experiments) {
    const jobs = pendingJobs(exp, dataset, done);
    const total = exp.runs * dataset.length;
    const label =
      `${exp.provider}/${exp.model} fs${exp.config.fewShotN} ` +
      `${exp.config.structured ? "structured" : "freetext"} ${exp.config.promptVariant}`;

    if (jobs.length === 0) {
      console.log(`SKIP  ${label} -- all ${total} runs already recorded`);
      continue;
    }

    const limit = concurrency ?? (exp.provider === "ollama" ? 1 : 4);
    console.log(`RUN   ${label} -- ${jobs.length}/${total} remaining, concurrency ${limit}`);

    let completed = 0;
    let invalid = 0;
    let correct = 0;
    const started = Date.now();
    await pool(jobs, limit, async (job) => {
      const record = await execute(job);
      appendFileSync(RUNS_PATH, JSON.stringify(record) + "\n");
      completed++;
      if (record.predicted === null) invalid++;
      if (record.correct) correct++;
      if (completed % 20 === 0 || completed === jobs.length) {
        const pct = ((correct / completed) * 100).toFixed(1);
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`      ${completed}/${jobs.length}  acc ${pct}%  invalid ${invalid}  ${secs}s`);
      }
    });
  }
}

const { experiments, concurrency } = parseInvocation();
runExperiments(experiments, concurrency)
  .then(() =>
    console.log(`\nDone. Raw records in ${RUNS_PATH}. Aggregate with: npx tsx src/eval/report.ts`),
  )
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

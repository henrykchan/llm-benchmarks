/**
 * Argument and matrix-file parsing for run.ts. Kept separate so the runner
 * itself stays about executing work, not about interpreting flags.
 *
 * `node:util`'s parseArgs only -- no CLI framework.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PROMPT_VARIANTS, type PromptVariant } from "../prompts.js";
import type { ExperimentConfig } from "../types.js";

export interface Experiment {
  provider: string;
  model: string;
  config: ExperimentConfig;
  runs: number;
}

export interface Invocation {
  experiments: Experiment[];
  concurrency: number | undefined;
}

export function parseConfig(
  fewShot: number,
  structured: boolean,
  variant: string,
): ExperimentConfig {
  if (fewShot !== 0 && fewShot !== 3 && fewShot !== 8) {
    throw new Error(`--few-shot must be 0, 3, or 8 (got ${fewShot})`);
  }
  if (!PROMPT_VARIANTS.includes(variant as PromptVariant)) {
    throw new Error(`--prompt-variant must be one of ${PROMPT_VARIANTS.join(", ")}`);
  }
  return { fewShotN: fewShot, structured, promptVariant: variant as PromptVariant };
}

interface MatrixEntry {
  provider: string;
  model: string;
  fewShotN: number;
  structured: boolean;
  promptVariant: string;
  runs?: number;
}

export function parseInvocation(): Invocation {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      "few-shot": { type: "string", default: "3" },
      runs: { type: "string", default: "3" },
      structured: { type: "string", default: "true" },
      "prompt-variant": { type: "string", default: "terse" },
      concurrency: { type: "string" },
      matrix: { type: "string" },
    },
  });

  const defaultRuns = Number(values.runs);
  let experiments: Experiment[];

  if (values.matrix) {
    const entries = JSON.parse(readFileSync(values.matrix, "utf8")) as MatrixEntry[];
    experiments = entries.map((e) => ({
      provider: e.provider,
      model: e.model,
      config: parseConfig(e.fewShotN, e.structured, e.promptVariant),
      runs: e.runs ?? defaultRuns,
    }));
  } else {
    if (!values.provider || !values.model) {
      throw new Error("--provider and --model are required (or use --matrix <file>)");
    }
    experiments = [
      {
        provider: values.provider,
        model: values.model,
        config: parseConfig(
          Number(values["few-shot"]),
          values.structured !== "false",
          values["prompt-variant"]!,
        ),
        runs: defaultRuns,
      },
    ];
  }

  return {
    experiments,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
  };
}

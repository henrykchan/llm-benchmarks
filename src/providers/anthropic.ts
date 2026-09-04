import Anthropic from "@anthropic-ai/sdk";
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationSchema,
  type ClassifyResult,
  type ExperimentConfig,
  type Provider,
} from "../types.js";
import { buildMessages, parseLooseCategory, systemPrompt, unstructuredSuffix } from "../prompts.js";

const TOOL_NAME = "classify_issue";

/**
 * Prompt caching is deliberately NOT enabled. Caching the few-shot prefix
 * would roughly halve spend, but cached calls return measurably faster, and
 * latency is a reported axis of this benchmark. Clean latency is worth more
 * than the saving at this budget.
 *
 * Thinking is left ON at `effort: "low"`. Disabling it on Opus 5 has a
 * documented failure mode where the model writes a tool call into visible text
 * instead of emitting a tool_use block -- which, since this path *forces* tool
 * use, would surface as a spurious invalid output and corrupt exactly the
 * metric the unstructured arm exists to measure.
 */
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

function tokens(usage: Usage | undefined): { input: number; output: number } {
  return { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 };
}

export const anthropicProvider: Provider = {
  name: "anthropic",

  async classify(
    text: string,
    model: string,
    config: ExperimentConfig,
  ): Promise<ClassifyResult> {
    const started = Date.now();
    const base: ClassifyResult = {
      label: null,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      raw: "",
      error: null,
    };

    try {
      const turns = buildMessages(text, config);
      const system = config.structured
        ? systemPrompt(config.promptVariant)
        : systemPrompt(config.promptVariant) + unstructuredSuffix();

      const messages = turns.map((t) => ({ role: t.role, content: t.content }));

      if (config.structured) {
        const res = await getClient().messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages,
          output_config: { effort: "low" },
          tools: [
            {
              name: TOOL_NAME,
              description: "Record the category the issue belongs to.",
              input_schema: CLASSIFICATION_JSON_SCHEMA as Anthropic.Tool["input_schema"],
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
        });

        const { input, output } = tokens(res.usage);
        const block = res.content.find((b) => b.type === "tool_use");
        const raw = block ? JSON.stringify(block.input) : JSON.stringify(res.content);
        const parsed = block ? ClassificationSchema.safeParse(block.input) : null;

        return {
          ...base,
          label: parsed?.success ? parsed.data.category : null,
          latencyMs: Date.now() - started,
          inputTokens: input,
          outputTokens: output,
          raw,
          error: parsed?.success
            ? null
            : block
              ? `schema validation failed: ${parsed?.error.message ?? "unknown"}`
              : `no tool_use block (stop_reason=${res.stop_reason})`,
        };
      }

      const res = await getClient().messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        output_config: { effort: "low" },
      });

      const { input, output } = tokens(res.usage);
      const raw = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const label = parseLooseCategory(raw);

      return {
        ...base,
        label,
        latencyMs: Date.now() - started,
        inputTokens: input,
        outputTokens: output,
        raw,
        error: label ? null : `unparseable free-text response: ${JSON.stringify(raw.slice(0, 200))}`,
      };
    } catch (err: unknown) {
      // Never throws into run.ts -- a provider failure is a recorded datum.
      return {
        ...base,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    }
  },
};

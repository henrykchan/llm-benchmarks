import { Ollama } from "ollama";
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationSchema,
  type ClassifyResult,
  type ExperimentConfig,
  type Provider,
} from "../types.js";
import { buildMessages, parseLooseCategory, systemPrompt, unstructuredSuffix } from "../prompts.js";

const host = process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
const client = new Ollama({ host });

/**
 * Ollama reports nanosecond timings. We record wall-clock latency as the
 * primary figure (it is what a caller actually experiences, and it is
 * comparable with the hosted provider), and keep `total_duration` as a
 * cross-check that the measurement is not dominated by client overhead.
 */
const NS_PER_MS = 1_000_000;

/**
 * temperature: 0 is NOT set. The benchmark reports variance across N runs, and
 * pinning temperature to zero would make that measurement vacuous while also
 * misrepresenting how these models are actually deployed. Defaults are used
 * throughout, for both providers.
 */
export const ollamaProvider: Provider = {
  name: "ollama",

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

      const res = await client.chat({
        model,
        messages: [{ role: "system", content: system }, ...turns],
        // Constrains generation so the model physically cannot emit preamble.
        ...(config.structured ? { format: CLASSIFICATION_JSON_SCHEMA } : {}),
        stream: false,
      });

      const raw = res.message.content.trim();
      const latencyMs = Date.now() - started;
      const inputTokens = res.prompt_eval_count ?? 0;
      const outputTokens = res.eval_count ?? 0;
      const serverMs = res.total_duration ? Math.round(res.total_duration / NS_PER_MS) : 0;

      if (!config.structured) {
        const label = parseLooseCategory(raw);
        return {
          ...base,
          label,
          latencyMs,
          inputTokens,
          outputTokens,
          raw,
          error: label
            ? null
            : `unparseable free-text response: ${JSON.stringify(raw.slice(0, 200))}`,
        };
      }

      let label = null;
      let error: string | null = null;
      try {
        const parsed = ClassificationSchema.safeParse(JSON.parse(raw));
        if (parsed.success) label = parsed.data.category;
        else error = `schema validation failed: ${parsed.error.message}`;
      } catch {
        // Constrained decoding makes this rare, but truncation at the context
        // limit can still yield incomplete JSON.
        error = `invalid JSON: ${JSON.stringify(raw.slice(0, 200))}`;
      }

      return {
        ...base,
        label,
        latencyMs,
        inputTokens,
        outputTokens,
        raw,
        error: error ? `${error} (server ${serverMs}ms)` : null,
      };
    } catch (err: unknown) {
      return {
        ...base,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    }
  },
};

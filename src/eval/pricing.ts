/**
 * Hosted pricing, USD per million tokens. Local models cost $0.00 in API
 * terms -- which is exactly why latency is reported next to cost, since the
 * real price of running locally is time and hardware, not dollars.
 *
 * Rates as of 2026-09; update alongside any model change.
 */
interface Price {
  input: number;
  output: number;
  label: string;
}

const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5, label: "Claude Haiku 4.5 (hosted, small)" },
  "claude-sonnet-5": { input: 2, output: 10, label: "Claude Sonnet 5 (hosted, mid)" },
  "claude-opus-5": { input: 5, output: 25, label: "Claude Opus 5 (hosted, large)" },
};

const LOCAL_LABELS: Record<string, string> = {
  "llama3.2:3b": "Llama 3.2 3B (local, ~2.0GB)",
  "qwen2.5:7b": "Qwen 2.5 7B (local, ~4.7GB)",
  "llama3.1:8b": "Llama 3.1 8B (local, ~4.9GB)",
};

/**
 * Dollars per 1,000 classifications. Returns null for local models -- reported
 * as $0.00, but null keeps "free" distinguishable from "genuinely measured as
 * zero" in the data.
 */
export function costPer1k(
  provider: string,
  model: string,
  avgInputTokens: number,
  avgOutputTokens: number,
): number | null {
  if (provider !== "anthropic") return null;
  const p = PRICES[model];
  if (!p) return null;
  return ((avgInputTokens * p.input + avgOutputTokens * p.output) / 1_000_000) * 1000;
}

export function describeModel(providerSlashModel: string): string {
  const model = providerSlashModel.split("/").slice(1).join("/");
  const price = PRICES[model];
  if (price) {
    return `\`${providerSlashModel}\` — ${price.label}, $${price.input}/$${price.output} per MTok`;
  }
  const local = LOCAL_LABELS[model];
  return `\`${providerSlashModel}\` — ${local ?? "local model"}, $0 API cost`;
}

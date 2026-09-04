/**
 * Provider registry. Adding a provider must require zero changes to run.ts --
 * plain functions in an object, no class hierarchy.
 */
import type { Provider } from "../types.js";
import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider } from "./ollama.js";

export const PROVIDERS: Record<string, Provider> = {
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

export function getProvider(name: string): Provider {
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error(
      `Unknown provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return p;
}

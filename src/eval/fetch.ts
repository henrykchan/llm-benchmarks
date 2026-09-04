/**
 * Pull closed, labelled pandas issues -> data/dataset.jsonl + data/fewshot.jsonl
 *
 * Classes are fetched per-label and balanced by construction. Random sampling
 * would skew heavily toward `bug` (8216 closed vs 1659 for questions) and
 * inflate the majority-class baseline.
 *
 * Two output files, deliberately disjoint: few-shot examples must never come
 * from the items being scored, or the 3-shot and 8-shot numbers are inflated
 * by train/test contamination -- a bug that never announces itself.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { CATEGORIES, type Category, type DatasetItem } from "../types.js";
import { cleanIssue, leakageHits, keywordMentions } from "./clean.js";

const REPO = "pandas-dev/pandas";
const PER_CLASS_EVAL = 10;
const PER_CLASS_FEWSHOT = 2;
const MIN_BODY_CHARS = 100;
const SEED = 20260904;

/** pandas' label names -> our four categories. */
const LABEL_MAP: Record<Category, string> = {
  bug: "Bug",
  enhancement: "Enhancement",
  documentation: "Docs",
  question: "Usage Question",
};

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  user: { login: string; type: string } | null;
  pull_request?: unknown;
}

/** Deterministic PRNG so re-running fetch reproduces the same dataset. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const PAGES_PER_LABEL = 3;

async function fetchLabel(label: string): Promise<GhIssue[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "llm-eval-harness",
  };
  const token = process.env["GITHUB_TOKEN"];
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const all: GhIssue[] = [];
  for (let page = 1; page <= PAGES_PER_LABEL; page++) {
    const url =
      `https://api.github.com/repos/${REPO}/issues` +
      `?labels=${encodeURIComponent(label)}&state=closed&per_page=100&page=${page}` +
      `&sort=created&direction=desc`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub ${res.status} for "${label}" p${page}: ${await res.text()}`);
    }
    const batch = (await res.json()) as GhIssue[];
    all.push(...batch);
    if (batch.length < 100) break; // last page
  }
  return all;
}

const ALL_MAPPED = new Set(Object.values(LABEL_MAP));

function isBot(issue: GhIssue): boolean {
  const login = issue.user?.login ?? "";
  return issue.user?.type === "Bot" || /\[bot\]$/i.test(login);
}

/** Reject anything whose ground truth is ambiguous or whose text is too thin. */
function keep(issue: GhIssue, category: Category): DatasetItem | null {
  if (issue.pull_request) return null; // the issues endpoint returns PRs too
  if (isBot(issue)) return null;
  const names = issue.labels.map((l) => l.name);
  if (names.length === 0) return null;
  const mapped = names.filter((n) => ALL_MAPPED.has(n));
  if (mapped.length !== 1) return null; // zero, or conflicting category labels
  if (mapped[0] !== LABEL_MAP[category]) return null;

  const text = cleanIssue(issue.title, issue.body);
  if (text.length < MIN_BODY_CHARS) return null;
  return { id: `${REPO}#${issue.number}`, text, label: category };
}

async function main(): Promise<void> {
  const rnd = mulberry32(SEED);
  const evalItems: DatasetItem[] = [];
  const fewShotItems: DatasetItem[] = [];

  for (const category of CATEGORIES) {
    const raw = await fetchLabel(LABEL_MAP[category]);
    const kept = raw.map((i) => keep(i, category)).filter((x): x is DatasetItem => x !== null);
    const picked = shuffle(kept, rnd).slice(0, PER_CLASS_EVAL + PER_CLASS_FEWSHOT);
    if (picked.length < PER_CLASS_EVAL + PER_CLASS_FEWSHOT) {
      throw new Error(
        `Only ${picked.length} usable items for "${category}" (fetched ${raw.length}, kept ${kept.length}). Widen the fetch.`,
      );
    }
    evalItems.push(...picked.slice(0, PER_CLASS_EVAL));
    fewShotItems.push(...picked.slice(PER_CLASS_EVAL));
    console.log(
      `${category.padEnd(14)} fetched ${String(raw.length).padStart(3)}  kept ${String(kept.length).padStart(3)}  -> ${PER_CLASS_EVAL} eval + ${PER_CLASS_FEWSHOT} few-shot`,
    );
  }

  mkdirSync("data", { recursive: true });
  const toJsonl = (xs: DatasetItem[]): string =>
    xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
  writeFileSync("data/dataset.jsonl", toJsonl(shuffle(evalItems, rnd)));
  writeFileSync("data/fewshot.jsonl", toJsonl(fewShotItems));

  const overlap = new Set(fewShotItems.map((i) => i.id));
  const contaminated = evalItems.filter((i) => overlap.has(i.id));
  console.log(
    `\nWrote ${evalItems.length} eval items and ${fewShotItems.length} few-shot items.` +
      `\nContamination check (must be 0): ${contaminated.length} shared ids.`,
  );

  const leaky = evalItems.filter((i) => leakageHits(i.text).length > 0);
  console.log(`Residual structural leakage: ${leaky.length}/${evalItems.length} items.`);
  for (const item of leaky) console.log(`  LEAK ${item.id}: ${leakageHits(item.text).join(", ")}`);

  // Prose cues are kept on purpose; report how often the cue matches the label,
  // since that is the rate at which a keyword-matcher would be right for free.
  let selfNaming = 0;
  for (const item of evalItems) {
    if (keywordMentions(item.text).includes(item.label)) selfNaming++;
  }
  console.log(
    `Prose cue matching own label: ${selfNaming}/${evalItems.length} items ` +
      `(kept deliberately -- real classifiers see these).`,
  );

  console.log("\n" + "=".repeat(78));
  console.log("EYEBALL THESE. Category must be inferable from prose but never stated.");
  console.log("=".repeat(78));
  for (const item of shuffle(evalItems, rnd).slice(0, 5)) {
    console.log(`\n--- ${item.id}  [label: ${item.label}] ---`);
    console.log(item.text.slice(0, 700));
  }
  console.log("\n" + "=".repeat(78));
  console.log("Do not proceed to run.ts until the above has been reviewed.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

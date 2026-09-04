/**
 * Leakage removal. This is the step that decides whether the benchmark
 * measures anything real.
 *
 * pandas stamps the answer into nearly every issue: titles are prefixed
 * `BUG:` / `ENH:` / `DOC:` / `QST:`, and the issue templates add checkbox
 * boilerplate ("I have confirmed this bug exists on the latest version") that
 * names the category outright. Left in, a regex would score ~100% and the
 * whole exercise would be theatre.
 *
 * Design decision worth defending: boilerplate that names a category is
 * removed, but category words in the *author's own prose* are kept. Someone
 * writing "this is a bug" in a free-text paragraph is genuine signal that a
 * real classifier would legitimately see. Redacting it would make the task
 * harder than reality rather than more honest.
 */

const PREFIX_TOKENS =
  "BUG|ENH|DOC|DOCS|QST|QUESTION|FEATURE(?:\\s+REQUEST)?|FEAT|API|PERF|TST|CLN|TYP|BLD|BUILD|DEPR|REGR|WEB|RLS|ERR|STYLE|REF|INT";

/**
 * Conventional-commit style prefixes pandas uses.
 *
 * The trailing delimiter is REQUIRED for the bare form. Making it optional
 * silently corrupted real titles: "DEPRecate method argument of reindex_like"
 * matched on `DEPR` and became "ecate ...". Bracketed forms (`[BUG] foo`) are
 * self-delimiting, so they get their own pattern. A leading `/` is allowed --
 * "/DOC: ..." occurs in the corpus.
 */
const TITLE_PREFIX_BRACKETED = new RegExp(
  `^[\\s/]*[\\[(]\\s*(?:${PREFIX_TOKENS})\\s*[\\])]\\s*[:\\-–—]?\\s*`,
  "i",
);
// Compound prefixes are common and self-documenting about the ambiguity they
// encode: "BUG/DOC: Migration User Guide is missing" is labelled `documentation`
// but its author thought it was both.
const TITLE_PREFIX_BARE = new RegExp(
  `^[\\s/]*(?:${PREFIX_TOKENS})(?:\\s*[/,+&]\\s*(?:${PREFIX_TOKENS}))*\\s*[:\\-–—]\\s*`,
  "i",
);

/** A markdown header whose text is essentially just a category name. */
const CATEGORY_HEADER =
  /^\s{0,3}#{1,6}\s*(?:bug(?:\s*report)?|feature\s*request|enhancement|documentation|docs?|question|usage\s*question|problem\s*description)\s*:?\s*$/gim;

/**
 * pandas' issue-template section headings. A closed, auditable set -- far
 * safer than a heuristic, because these are the strongest leak in the corpus:
 * "Location of the documentation" and "Feature Type" give the answer away
 * outright, and they survive generic header handling since they are not bare
 * category names. Matched as whole lines, with or without their `#` markers.
 */
const TEMPLATE_HEADINGS = [
  "pandas version checks",
  "reproducible example",
  "issue description",
  "expected behavior",
  "expected results",
  "actual results",
  "installed versions",
  "feature type",
  "problem description",
  "feature description",
  "alternative solutions",
  "additional context",
  "location of the documentation",
  "documentation problem",
  "suggested fix for documentation",
  "research",
  "question about pandas",
  "prior related issues",
  "describe the solution",
  "describe alternatives",
  "steps to reproduce",
  "current behavior",
  "desired behavior",
  "minimal complete verifiable example",
];

const TEMPLATE_HEADING_RE = new RegExp(
  `^\\s{0,3}(?:#{1,6}\\s*)?(?:${TEMPLATE_HEADINGS.map((h) => h.replace(/ /g, "\\s+")).join("|")})\\s*:?\\s*$`,
  "gim",
);

/** pandas template sentences that name the category as boilerplate. */
const BOILERPLATE_LINES: RegExp[] = [
  /^.*I have checked that this issue has not already been reported.*$/gim,
  /^.*I have confirmed this (?:bug|issue).*$/gim,
  /^.*I have confirmed this .* exists on the (?:latest|main).*$/gim,
  /^.*reproducible example.*$/gim,
  /^.*I would like to implement this (?:feature|enhancement).*$/gim,
  /^.*this (?:feature|enhancement) (?:request|is).*already (?:been )?requested.*$/gim,
  /^.*searched the documentation.*$/gim,
];

/**
 * Everything from the environment dump onward is uninformative filler that
 * would otherwise dominate the token budget.
 */
const TRAILING_SECTIONS =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:installed versions|version information|output of ``?pd\.show_versions\(\)``?|environment)\b[\s\S]*$/i;

const MAX_BODY_CHARS = 1200;

/** Strip the category prefix pandas puts at the front of nearly every title. */
export function cleanTitle(title: string): string {
  let t = title;
  // Applied twice: titles like "BUG: ENH: ..." and "[BUG] QST: ..." do occur.
  for (let i = 0; i < 2; i++) {
    t = t.replace(TITLE_PREFIX_BRACKETED, "").replace(TITLE_PREFIX_BARE, "");
  }
  return t.trim();
}

export function cleanBody(body: string): string {
  let b = body.replace(/\r\n/g, "\n");

  b = b.replace(/<!--[\s\S]*?-->/g, ""); // template instructions
  b = b.replace(TRAILING_SECTIONS, "");
  b = b.replace(/<details>[\s\S]*?<\/details>/gi, ""); // collapsed version dumps
  b = b.replace(/^\s*-?\s*\[[ xX]\].*$/gm, ""); // every checkbox line: pure template
  b = b.replace(CATEGORY_HEADER, "");
  b = b.replace(TEMPLATE_HEADING_RE, ""); // must run before `#` markers are stripped
  for (const re of BOILERPLATE_LINES) b = b.replace(re, "");

  b = b.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  b = b.replace(/^\s*#{1,6}\s*/gm, ""); // remaining header markers, keep their text
  b = b.replace(/\n{3,}/g, "\n\n").trim();

  if (b.length > MAX_BODY_CHARS) b = b.slice(0, MAX_BODY_CHARS).trimEnd() + " …";
  return b;
}

export function cleanIssue(title: string, body: string | null): string {
  const t = cleanTitle(title);
  const b = cleanBody(body ?? "");
  return b ? `${t}\n\n${b}` : t;
}

/**
 * Residual leakage check. Not used to filter -- prose mentions are kept on
 * purpose -- but reported at fetch time so the rate is a known number rather
 * than an assumption, and so a regression in the cleaners is visible.
 */
export function leakageHits(text: string): string[] {
  const hits: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["title-prefix", TITLE_PREFIX_BRACKETED],
    ["title-prefix", TITLE_PREFIX_BARE],
    ["checkbox", /^\s*-?\s*\[[ xX]\]/m],
    ["category-header", /^\s{0,3}#{1,6}\s*(?:bug|enhancement|documentation|question)\s*:?\s*$/im],
    ["template-heading", new RegExp(TEMPLATE_HEADING_RE.source, "im")],
  ];
  for (const [name, re] of patterns) if (re.test(text)) hits.push(name);
  return hits;
}

/**
 * Counts prose mentions of each category cue. These are deliberately *kept*
 * (see the module header), so this is not a filter -- it exists so the
 * residual rate is a measured number quoted in ANALYSIS.md rather than an
 * assumption, and so a per-class skew is visible if one develops.
 */
export function keywordMentions(text: string): string[] {
  const cues: Array<[string, RegExp]> = [
    ["bug", /\bbugs?\b/i],
    ["enhancement", /\b(?:enhancements?|feature\s+requests?)\b/i],
    ["documentation", /\b(?:documentation|docs?|docstrings?)\b/i],
    ["question", /\bquestions?\b/i],
  ];
  return cues.filter(([, re]) => re.test(text)).map(([name]) => name);
}

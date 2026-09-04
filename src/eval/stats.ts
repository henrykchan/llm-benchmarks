/**
 * The two statistics that decide whether any claim in this benchmark is
 * defensible at n=40. Pure functions, no I/O.
 *
 * Why these specifically: with 40 items, the 95% interval on an accuracy near
 * 0.90 is roughly ±9 points. Reporting a bare "84.2% vs 88.7%" invites a
 * conclusion the data cannot support. Wilson intervals make the uncertainty
 * visible; McNemar's test makes model-vs-model comparison legitimate by
 * exploiting the fact that every model sees the identical items.
 */

/**
 * Wilson score interval. Preferred over the normal approximation, which
 * produces intervals extending below 0 or above 1 near the boundaries -- and
 * accuracies near 1.0 are exactly the regime this benchmark operates in.
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Binomial coefficient. Exact for the small n this module sees. */
function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export interface McNemarResult {
  /** Items where A was correct and B was wrong. */
  b: number;
  /** Items where A was wrong and B was correct. */
  c: number;
  pValue: number;
}

/**
 * McNemar's test, exact binomial form.
 *
 * Only the discordant pairs carry information: items both models get right, or
 * both get wrong, say nothing about which is better. Under the null the b/c
 * split is Binomial(b+c, 0.5).
 *
 * The exact form is used rather than the chi-square approximation because
 * discordant counts here are routinely under 25, where the approximation is
 * unreliable.
 */
export function mcnemar(aCorrect: boolean[], bCorrect: boolean[]): McNemarResult {
  if (aCorrect.length !== bCorrect.length) {
    throw new Error("McNemar requires paired vectors of equal length");
  }
  let b = 0;
  let c = 0;
  for (let i = 0; i < aCorrect.length; i++) {
    if (aCorrect[i] && !bCorrect[i]) b++;
    else if (!aCorrect[i] && bCorrect[i]) c++;
  }
  const n = b + c;
  if (n === 0) return { b, c, pValue: 1 };

  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binom(n, i);
  return { b, c, pValue: Math.min(1, (2 * tail) / Math.pow(2, n)) };
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, x) => a + x, 0) / xs.length;
}

/** Sample standard deviation (n-1). With N=3 runs the distinction matters. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Reference values computed independently; guards the off-by-one and
 * two-sided-doubling errors that make a statistics implementation
 * confidently wrong. Run via `report.ts --self-test`. */
export function selfTest(): { passed: number; failed: string[] } {
  const failed: string[] = [];
  let passed = 0;
  const close = (a: number, b: number, tol = 1e-5): boolean => Math.abs(a - b) < tol;

  const wilsonCases: Array<[number, number, number, number]> = [
    [36, 40, 0.769479, 0.960421],
    [0, 10, 0.0, 0.27754],
    [40, 40, 0.912375, 1.0],
    [20, 40, 0.351993, 0.648007],
    [10, 40, 0.14187, 0.401943],
  ];
  for (const [s, n, lo, hi] of wilsonCases) {
    const [gotLo, gotHi] = wilsonInterval(s, n);
    if (close(gotLo, lo) && close(gotHi, hi)) passed++;
    else failed.push(`wilson(${s},${n}) = [${gotLo.toFixed(6)}, ${gotHi.toFixed(6)}] want [${lo}, ${hi}]`);
  }

  const mkPair = (b: number, c: number, both = 5): [boolean[], boolean[]] => {
    const a: boolean[] = [];
    const d: boolean[] = [];
    for (let i = 0; i < b; i++) { a.push(true); d.push(false); }
    for (let i = 0; i < c; i++) { a.push(false); d.push(true); }
    for (let i = 0; i < both; i++) { a.push(true); d.push(true); }
    return [a, d];
  };
  const mcCases: Array<[number, number, number]> = [
    [10, 2, 0.038574],
    [5, 5, 1.0],
    [8, 1, 0.039062],
    [0, 0, 1.0],
    [3, 0, 0.25],
  ];
  for (const [b, c, want] of mcCases) {
    const [x, y] = mkPair(b, c);
    const got = mcnemar(x, y);
    if (got.b === b && got.c === c && close(got.pValue, want)) passed++;
    else failed.push(`mcnemar(b=${b},c=${c}) = {b:${got.b},c:${got.c},p:${got.pValue.toFixed(6)}} want p=${want}`);
  }

  if (close(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13809)) passed++;
  else failed.push(`stdev sample check = ${stdev([2, 4, 4, 4, 5, 5, 7, 9])}`);

  return { passed, failed };
}

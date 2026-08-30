export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function computeAverage(parts: Array<string | number | null | undefined>): string | null {
  const nums = parts.map(toNumber).filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return avg.toFixed(2);
}

export function isValidScore(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

import type { Period } from "./types";

const pct = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${pct.format(n)}%`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isCurrentPeriod(p: Period): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return p.starts_on <= today && today <= p.ends_on;
}

/** Sums weights using integer (cents) arithmetic to avoid float errors. */
export function weightSum(weights: number[]): number {
  return weights.reduce((s, w) => s + Math.round(w * 100), 0) / 100;
}

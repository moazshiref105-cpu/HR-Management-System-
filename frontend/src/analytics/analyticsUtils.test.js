import test from "node:test";
import assert from "node:assert/strict";
import { currentYearRange, formatDate, rangeFor } from "./analyticsUtils.js";

test("year-to-date boundaries use the company calendar date without UTC day shifts", () => {
  const justAfterCairoMidnight = new Date("2026-01-01T00:15:00+02:00");
  assert.deepEqual(currentYearRange(justAfterCairoMidnight), { from: "2026-01-01", to: "2026-01-01" });
  assert.deepEqual(rangeFor("year", justAfterCairoMidnight), { from: "2026-01-01", to: "2026-01-01" });
  assert.equal(formatDate("2026-01-01"), "1 Jan 2026");
});

test("month, quarter, and trailing-year presets retain date-only calendar boundaries", () => {
  const cairoMidnight = new Date("2026-03-01T00:10:00+02:00");
  assert.deepEqual(rangeFor("month", cairoMidnight), { from: "2026-03-01", to: "2026-03-01" });
  assert.deepEqual(rangeFor("last_month", cairoMidnight), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(rangeFor("quarter", cairoMidnight), { from: "2026-01-01", to: "2026-03-01" });
  assert.deepEqual(rangeFor("last_quarter", cairoMidnight), { from: "2025-10-01", to: "2025-12-31" });
  assert.deepEqual(rangeFor("trailing_12", cairoMidnight), { from: "2025-04-01", to: "2026-03-01" });
});

test("year-to-date uses the intended company year on the UTC/Cairo boundary", () => {
  const cairoNewYearEve = new Date("2025-12-31T22:30:00Z");
  assert.deepEqual(currentYearRange(cairoNewYearEve), { from: "2026-01-01", to: "2026-01-01" });
});

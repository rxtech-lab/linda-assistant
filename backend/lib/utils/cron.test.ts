import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { isValidCronExpression, getNextRunSeconds } from "./cron";

describe("isValidCronExpression", () => {
  test("accepts standard 5-field expressions", () => {
    expect(isValidCronExpression("* * * * *")).toBe(true);
    expect(isValidCronExpression("0 9 * * *")).toBe(true);
    expect(isValidCronExpression("30 8 * * 1-5")).toBe(true);
    expect(isValidCronExpression("0 0 1 * *")).toBe(true);
    expect(isValidCronExpression("0 0 * * 0")).toBe(true);
  });

  test("accepts step and range expressions", () => {
    expect(isValidCronExpression("*/5 * * * *")).toBe(true);
    expect(isValidCronExpression("0 */2 * * *")).toBe(true);
    expect(isValidCronExpression("0 9-17 * * 1-5")).toBe(true);
    expect(isValidCronExpression("0 9,12,18 * * *")).toBe(true);
    expect(isValidCronExpression("0 0 1,15 * *")).toBe(true);
  });

  test("rejects plain text strings", () => {
    expect(isValidCronExpression("not-a-cron")).toBe(false);
    expect(isValidCronExpression("every day")).toBe(false);
  });

  test("rejects out-of-range minute values", () => {
    expect(isValidCronExpression("60 * * * *")).toBe(false);
  });

  test("rejects out-of-range hour values", () => {
    expect(isValidCronExpression("* 25 * * *")).toBe(false);
  });

  test("rejects out-of-range day-of-month values", () => {
    expect(isValidCronExpression("* * 32 * *")).toBe(false);
  });

  test("rejects out-of-range month values", () => {
    expect(isValidCronExpression("* * * 13 *")).toBe(false);
  });

  test("rejects out-of-range weekday values", () => {
    expect(isValidCronExpression("* * * * 8")).toBe(false);
  });
});

describe("getNextRunSeconds", () => {
  // Pin "now" to a fixed point: 2026-01-01 00:00:00 UTC (Thursday)
  const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

  let dateSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    dateSpy = spyOn(Date, "now").mockReturnValue(FIXED_NOW.getTime());
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  test("returns null for invalid expression", () => {
    expect(getNextRunSeconds("not-a-cron")).toBeNull();
    expect(getNextRunSeconds("60 * * * *")).toBeNull();
  });

  test("no lastRunAt: next occurrence computed from now", () => {
    // "0 1 * * *" → next 01:00 UTC after 00:00 Jan 1 = 01:00 Jan 1 → 3600s
    const secs = getNextRunSeconds("0 1 * * *");
    expect(secs).toBe(3600);
  });

  test("no lastRunAt with every-minute schedule: next run is 60s away", () => {
    // "* * * * *" → next tick after 00:00:00 = 00:01:00 → 60s
    const secs = getNextRunSeconds("* * * * *");
    expect(secs).toBe(60);
  });

  test("null lastRunAt behaves the same as omitting it", () => {
    const withNull = getNextRunSeconds("0 6 * * *", null);
    const withUndefined = getNextRunSeconds("0 6 * * *", undefined);
    expect(withNull).toBe(withUndefined);
  });

  test("with recent lastRunAt: returns seconds from now to next tick after lastRunAt", () => {
    // lastRunAt = 2025-12-31T22:00:00Z (2 hours before FIXED_NOW)
    // "0 0 * * *" → next midnight after 22:00 Dec 31 = 00:00 Jan 1 = FIXED_NOW
    // That's not > now, so falls back to next from now = 00:00 Jan 2 = 86400s
    const lastRunAt = new Date("2025-12-31T22:00:00.000Z");
    const secs = getNextRunSeconds("0 0 * * *", lastRunAt);
    expect(secs).toBe(86400);
  });

  test("with very recent lastRunAt, next run is still in the future", () => {
    // lastRunAt = 23:58 yesterday; every-5-minute schedule
    // "*/5 * * * *" → next 5-minute tick after 23:58 = 00:00 Jan 1 = FIXED_NOW
    // That's not > now, so falls back to next from now = 00:05 = 300s
    const lastRunAt = new Date("2025-12-31T23:58:00.000Z");
    const secs = getNextRunSeconds("*/5 * * * *", lastRunAt);
    expect(secs).toBe(300);
  });

  test("with lastRunAt where next occurrence is genuinely in the future", () => {
    // lastRunAt = 2025-12-31T08:00:00Z (16 hours before FIXED_NOW)
    // "0 9 * * *" → next 09:00 after 08:00 Dec 31 = 09:00 Dec 31 (in the past)
    // That's not > now, falls back to next from FIXED_NOW = 09:00 Jan 1 = 32400s
    const lastRunAt = new Date("2025-12-31T08:00:00.000Z");
    const secs = getNextRunSeconds("0 9 * * *", lastRunAt);
    expect(secs).toBe(32400);
  });

  test("with lastRunAt far in the past: falls back to next future occurrence", () => {
    // lastRunAt = 1 year ago; daily-at-9am cron
    // Next after lastRunAt = Jan 2 2025 09:00 (in the past) → falls back to now
    // → next 9am from FIXED_NOW = Jan 1 2026 09:00 = 32400s
    const lastRunAt = new Date("2025-01-01T09:00:00.000Z");
    const secs = getNextRunSeconds("0 9 * * *", lastRunAt);
    expect(secs).toBe(32400);
  });

  test("with lastRunAt just before a future tick: uses that tick", () => {
    // lastRunAt = 2025-12-31T23:59:00Z (1 minute before FIXED_NOW)
    // "* * * * *" → next minute after 23:59 = 00:00 Jan 1 = FIXED_NOW (not > now)
    // Falls back to next from now = 00:01 = 60s
    const lastRunAt = new Date("2025-12-31T23:59:00.000Z");
    const secs = getNextRunSeconds("* * * * *", lastRunAt);
    expect(secs).toBe(60);
  });
});

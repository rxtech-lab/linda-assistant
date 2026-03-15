import { describe, test, expect } from "bun:test";
import { convertRunsAtToUTC, convertCronToUTC } from "./timezone";

describe("convertRunsAtToUTC", () => {
  test("returns as-is when runsAt already has Z suffix", () => {
    expect(convertRunsAtToUTC("2025-06-15T09:00:00Z")).toBe("2025-06-15T09:00:00Z");
  });

  test("returns as-is when runsAt already has timezone offset", () => {
    expect(convertRunsAtToUTC("2025-06-15T09:00:00+05:30")).toBe("2025-06-15T09:00:00+05:30");
    expect(convertRunsAtToUTC("2025-06-15T09:00:00-08:00")).toBe("2025-06-15T09:00:00-08:00");
  });

  test("appends Z when no session timezone provided", () => {
    expect(convertRunsAtToUTC("2025-06-15T09:00:00")).toBe("2025-06-15T09:00:00Z");
  });

  test("appends Z when session timezone is null", () => {
    expect(convertRunsAtToUTC("2025-06-15T09:00:00", null)).toBe("2025-06-15T09:00:00Z");
  });

  test("converts from America/New_York (UTC-5 in winter) to UTC", () => {
    // 2025-01-15T09:00:00 in EST (UTC-5) should be 2025-01-15T14:00:00Z
    const result = convertRunsAtToUTC("2025-01-15T09:00:00", "America/New_York");
    const resultDate = new Date(result);
    expect(resultDate.getUTCHours()).toBe(14);
    expect(resultDate.getUTCMinutes()).toBe(0);
  });

  test("converts from Asia/Tokyo (UTC+9) to UTC", () => {
    // 2025-06-15T09:00:00 in JST (UTC+9) should be 2025-06-15T00:00:00Z
    const result = convertRunsAtToUTC("2025-06-15T09:00:00", "Asia/Tokyo");
    const resultDate = new Date(result);
    expect(resultDate.getUTCHours()).toBe(0);
    expect(resultDate.getUTCMinutes()).toBe(0);
  });

  test("converts from Asia/Kolkata (UTC+5:30) to UTC", () => {
    // 2025-06-15T09:00:00 in IST (UTC+5:30) should be 2025-06-15T03:30:00Z
    const result = convertRunsAtToUTC("2025-06-15T09:00:00", "Asia/Kolkata");
    const resultDate = new Date(result);
    expect(resultDate.getUTCHours()).toBe(3);
    expect(resultDate.getUTCMinutes()).toBe(30);
  });

  test("handles UTC timezone (no offset change)", () => {
    const result = convertRunsAtToUTC("2025-06-15T09:00:00", "UTC");
    const resultDate = new Date(result);
    expect(resultDate.getUTCHours()).toBe(9);
    expect(resultDate.getUTCMinutes()).toBe(0);
  });
});

describe("convertCronToUTC", () => {
  test("returns as-is when no session timezone provided", () => {
    expect(convertCronToUTC("0 9 * * *")).toBe("0 9 * * *");
    expect(convertCronToUTC("0 9 * * *", null)).toBe("0 9 * * *");
  });

  test("returns as-is when timezone is UTC", () => {
    expect(convertCronToUTC("0 9 * * *", "UTC")).toBe("0 9 * * *");
  });

  test("converts hour from Asia/Tokyo (UTC+9) to UTC", () => {
    // 9 AM in JST (UTC+9) → 0 AM UTC
    const result = convertCronToUTC("0 9 * * *", "Asia/Tokyo");
    expect(result).toBe("0 0 * * *");
  });

  test("handles day wrap (negative UTC hour)", () => {
    // 3 AM in Asia/Tokyo (UTC+9) → 18:00 (6 PM) previous day UTC
    const result = convertCronToUTC("0 3 * * *", "Asia/Tokyo");
    expect(result).toBe("0 18 * * *");
  });

  test("returns as-is for wildcard hour fields", () => {
    expect(convertCronToUTC("0 * * * *", "Asia/Tokyo")).toBe("0 * * * *");
    expect(convertCronToUTC("*/5 */2 * * *", "Asia/Tokyo")).toBe("*/5 */2 * * *");
  });

  test("returns as-is for range hour fields", () => {
    expect(convertCronToUTC("0 9-17 * * *", "Asia/Tokyo")).toBe("0 9-17 * * *");
  });

  test("returns as-is for list hour fields", () => {
    expect(convertCronToUTC("0 9,12,18 * * *", "Asia/Tokyo")).toBe("0 9,12,18 * * *");
  });

  test("returns as-is for invalid cron expressions", () => {
    expect(convertCronToUTC("not-a-cron", "Asia/Tokyo")).toBe("not-a-cron");
    expect(convertCronToUTC("0 9", "Asia/Tokyo")).toBe("0 9");
  });
});

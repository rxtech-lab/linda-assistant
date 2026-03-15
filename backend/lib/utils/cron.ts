import cronParser from "cron-parser";

/** Returns true if the given string is a valid 5-field cron expression. */
export function isValidCronExpression(expr: string): boolean {
  try {
    cronParser.parseExpression(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the number of seconds from NOW until the next scheduled occurrence.
 * When lastRunAt is provided, computes the next occurrence after that time —
 * this gives an accurate "time until next run" based on the last actual execution.
 * If the next occurrence after lastRunAt is already in the past (missed run),
 * falls back to the next occurrence from now.
 * Returns null if the expression is invalid or parsing fails.
 */
export function getNextRunSeconds(expr: string, lastRunAt?: Date | null): number | null {
  try {
    const now = new Date(Date.now());

    if (lastRunAt) {
      const afterLastRun = cronParser
        .parseExpression(expr, { currentDate: lastRunAt })
        .next()
        .toDate();
      if (afterLastRun > now) {
        return Math.floor((afterLastRun.getTime() - now.getTime()) / 1000);
      }
    }

    // Fallback: next occurrence from now
    const next = cronParser.parseExpression(expr).next().toDate();
    return Math.floor((next.getTime() - now.getTime()) / 1000);
  } catch {
    return null;
  }
}

/**
 * Convert a runsAt datetime string to UTC, using the session's timezone if
 * the value doesn't already carry an explicit offset/Z suffix.
 *
 * - If runsAt already has timezone info (ends with Z or ±HH:MM), return as-is.
 * - Otherwise, interpret it as local time in `sessionTimezone` and convert to UTC ISO string.
 * - If sessionTimezone is not provided, treat as UTC.
 */
export function convertRunsAtToUTC(runsAt: string, sessionTimezone?: string | null): string {
  // Already has timezone offset (Z or ±HH:MM), possibly with fractional seconds
  if (/(\.\d+)?Z$|[+-]\d{2}:\d{2}$/.test(runsAt)) {
    return runsAt;
  }

  if (!sessionTimezone) {
    // No session timezone — treat as UTC
    return runsAt.endsWith("Z") ? runsAt : `${runsAt}Z`;
  }

  // Parse the naive datetime in the given timezone and convert to UTC
  try {
    // Create a date formatter that can give us the UTC offset for the timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: sessionTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    });

    // Parse the input as a Date (treated as UTC initially)
    const naiveDate = new Date(`${runsAt}Z`);
    if (isNaN(naiveDate.getTime())) {
      return runsAt;
    }

    // Get the UTC offset for the target timezone at the given time
    const parts = formatter.formatToParts(naiveDate);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const offsetStr = tzPart?.value || "GMT";

    // Parse offset like "GMT+05:30" or "GMT-08:00" or "GMT"
    const offsetMatch = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const sign = offsetMatch[1] === "+" ? 1 : -1;
      offsetMinutes = sign * (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3], 10));
    }

    // The naive datetime represents local time in sessionTimezone.
    // To get UTC: subtract the timezone offset from the local time.
    const localMs = naiveDate.getTime(); // This is the naive time interpreted as UTC
    const utcMs = localMs - offsetMinutes * 60 * 1000;
    return new Date(utcMs).toISOString();
  } catch {
    return runsAt;
  }
}

/**
 * Convert a cron schedule from a user's timezone to UTC.
 * Only adjusts the hour field based on the timezone offset.
 *
 * Returns the original expression unchanged when:
 * - No sessionTimezone is provided (or null)
 * - The timezone is UTC (no offset)
 * - The expression is not a standard 5-field cron format
 * - The hour field is not a simple integer (e.g. wildcards, ranges, lists like `*`, `9-17`, `9,12`)
 * - An error occurs during conversion
 *
 * Note: Does not adjust the day-of-month field when hour conversion crosses midnight.
 * For cron schedules near midnight boundaries in non-UTC timezones, consider specifying
 * the schedule directly in UTC.
 */
export function convertCronToUTC(cronSchedule: string, sessionTimezone?: string | null): string {
  if (!sessionTimezone) return cronSchedule;

  try {
    const parts = cronSchedule.trim().split(/\s+/);
    if (parts.length !== 5) return cronSchedule;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Only convert simple numeric hours (not ranges, lists, wildcards, etc.)
    const hourNum = parseInt(hour, 10);
    if (isNaN(hourNum) || hour !== String(hourNum)) return cronSchedule;

    // Get the UTC offset for the timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: sessionTimezone,
      timeZoneName: "longOffset",
    });
    const tzParts = formatter.formatToParts(now);
    const tzPart = tzParts.find((p) => p.type === "timeZoneName");
    const offsetStr = tzPart?.value || "GMT";

    const offsetMatch = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!offsetMatch) return cronSchedule; // UTC, no conversion needed

    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetHours = sign * parseInt(offsetMatch[2], 10);
    const offsetMins = sign * parseInt(offsetMatch[3], 10);

    // Convert from local hour to UTC: subtract offset
    let utcHour = hourNum - offsetHours;
    // Only adjust minutes when the minute field is a simple integer
    const minuteIsSimple = /^\d+$/.test(minute) && minute === String(parseInt(minute, 10));
    let adjustedMinute = minute;
    if (minuteIsSimple && offsetMins !== 0) {
      let minuteNum = parseInt(minute, 10) - offsetMins;
      if (minuteNum < 0) {
        minuteNum += 60;
        utcHour -= 1;
      } else if (minuteNum >= 60) {
        minuteNum -= 60;
        utcHour += 1;
      }
      adjustedMinute = String(minuteNum);
    }

    // Wrap hour around 24h
    utcHour = ((utcHour % 24) + 24) % 24;

    return `${adjustedMinute} ${utcHour} ${dayOfMonth} ${month} ${dayOfWeek}`;
  } catch {
    return cronSchedule;
  }
}

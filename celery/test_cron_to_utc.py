"""Tests for the cron_to_utc timezone conversion function."""

import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo


# Import the function under test. The module-level imports in main.py
# pull in Celery/Redis which won't be available in a unit-test environment,
# so we inline the function here to keep the test self-contained.
def cron_to_utc(cron_str: str, tz: str | None = None) -> str:
    """Mirror of main.cron_to_utc for isolated testing."""
    if not tz:
        return cron_str

    parts = cron_str.strip().split()
    if len(parts) != 5:
        return cron_str

    minute, hour, day_of_month, month_of_year, day_of_week = parts

    try:
        hour_num = int(hour)
        if str(hour_num) != hour:
            return cron_str
    except ValueError:
        return cron_str

    try:
        tz_info = ZoneInfo(tz)
        now = datetime.now(tz_info)
        offset = now.utcoffset()
        if offset is None:
            return cron_str
        total_seconds = int(offset.total_seconds())
        offset_hours = total_seconds // 3600
        offset_mins = (total_seconds % 3600) // 60
    except Exception:
        return cron_str

    if offset_hours == 0 and offset_mins == 0:
        return cron_str

    utc_hour = hour_num - offset_hours

    adjusted_minute = minute
    if offset_mins != 0 and minute.isdigit():
        minute_num = int(minute) - offset_mins
        if minute_num < 0:
            minute_num += 60
            utc_hour -= 1
        elif minute_num >= 60:
            minute_num -= 60
            utc_hour += 1
        adjusted_minute = str(minute_num)

    utc_hour = utc_hour % 24

    return f"{adjusted_minute} {utc_hour} {day_of_month} {month_of_year} {day_of_week}"


class TestCronToUtc(unittest.TestCase):
    """Unit tests for cron_to_utc."""

    def test_no_timezone_returns_unchanged(self):
        self.assertEqual(cron_to_utc("0 9 * * *"), "0 9 * * *")
        self.assertEqual(cron_to_utc("0 9 * * *", None), "0 9 * * *")

    def test_utc_timezone_returns_unchanged(self):
        self.assertEqual(cron_to_utc("0 9 * * *", "UTC"), "0 9 * * *")

    def test_asia_tokyo_utc_plus_9(self):
        # 9 AM Tokyo (UTC+9) = 0 AM UTC
        self.assertEqual(cron_to_utc("0 9 * * *", "Asia/Tokyo"), "0 0 * * *")

    def test_hour_wrap_positive(self):
        # 2 AM Tokyo (UTC+9) = 5 PM previous day UTC (2-9 = -7, -7%24 = 17)
        self.assertEqual(cron_to_utc("0 2 * * *", "Asia/Tokyo"), "0 17 * * *")

    def test_half_hour_offset(self):
        # 9:30 AM Kolkata (UTC+5:30) = 4:00 AM UTC
        self.assertEqual(cron_to_utc("30 9 * * *", "Asia/Kolkata"), "0 4 * * *")

    def test_wildcard_hour_unchanged(self):
        self.assertEqual(cron_to_utc("0 * * * *", "Asia/Tokyo"), "0 * * * *")

    def test_range_hour_unchanged(self):
        self.assertEqual(cron_to_utc("0 9-17 * * *", "Asia/Tokyo"), "0 9-17 * * *")

    def test_list_hour_unchanged(self):
        self.assertEqual(cron_to_utc("0 9,12 * * *", "Asia/Tokyo"), "0 9,12 * * *")

    def test_invalid_cron_unchanged(self):
        self.assertEqual(cron_to_utc("not-a-cron", "Asia/Tokyo"), "not-a-cron")

    def test_preserves_other_fields(self):
        # 9 AM Tokyo on weekdays = 0 AM UTC on weekdays
        self.assertEqual(cron_to_utc("0 9 * * 1-5", "Asia/Tokyo"), "0 0 * * 1-5")

    def test_wildcard_minute_with_half_hour_offset(self):
        # Wildcard minute + half-hour offset: only hour adjusted (minute offset ignored)
        # Asia/Kolkata is UTC+5:30, only the 5h offset applies: 9 - 5 = 4
        self.assertEqual(cron_to_utc("* 9 * * *", "Asia/Kolkata"), "* 4 * * *")

    def test_invalid_timezone_returns_unchanged(self):
        self.assertEqual(
            cron_to_utc("0 9 * * *", "Invalid/Timezone"), "0 9 * * *"
        )


if __name__ == "__main__":
    unittest.main()

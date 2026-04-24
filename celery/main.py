from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from celery.schedules import crontab
from redbeat import RedBeatSchedulerEntry
import redis
from worker import app as celery_app, execute_task
from config import CELERY_ADMIN_KEY, CELERY_REDIS_URL

api = FastAPI(title="Linda Celery Scheduler")


def verify_admin_key(authorization: str = Header(...)):
    expected = f"Bearer {CELERY_ADMIN_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class ScheduleCreate(BaseModel):
    task_id: str
    cron_schedule: str  # e.g. "0 9 * * *"
    timezone: str | None = None  # IANA timezone, e.g. "America/New_York"


class ScheduleUpdate(BaseModel):
    cron_schedule: str
    timezone: str | None = None


class ExecuteOnceBody(BaseModel):
    task_id: str
    eta: str  # ISO datetime


class ExecuteNowBody(BaseModel):
    task_id: str


def cron_to_utc(cron_str: str, tz: str | None = None) -> str:
    """Convert a cron expression from the given IANA timezone to UTC.

    Only adjusts simple numeric hour (and minute) fields. Wildcards, ranges,
    lists, and step expressions are left untouched. Returns the original
    expression when no conversion is needed or possible.

    Note: The conversion uses the current UTC offset for the timezone at
    registration time. For timezones that observe DST, the effective local
    time may shift by one hour when DST transitions occur. Tasks near DST
    boundaries may need to be re-registered to stay accurate.
    """
    if not tz:
        return cron_str

    parts = cron_str.strip().split()
    if len(parts) != 5:
        return cron_str

    minute, hour, day_of_month, month_of_year, day_of_week = parts

    # Only convert simple numeric hours
    try:
        hour_num = int(hour)
        if str(hour_num) != hour:
            return cron_str
    except ValueError:
        return cron_str

    # Get the current UTC offset for the timezone
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

    # Convert from local hour to UTC: subtract offset
    utc_hour = hour_num - offset_hours

    # Adjust minutes when the minute field is a simple integer
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

    # Wrap hour around 24h
    utc_hour = utc_hour % 24

    return f"{adjusted_minute} {utc_hour} {day_of_month} {month_of_year} {day_of_week}"


def parse_crontab(cron_str: str) -> crontab:
    """Parse a 5-field cron expression into a Celery crontab."""
    parts = cron_str.strip().split()
    if len(parts) != 5:
        raise HTTPException(status_code=422, detail="cron_schedule must be a 5-field cron expression")
    minute, hour, day_of_month, month_of_year, day_of_week = parts
    return crontab(
        minute=minute,
        hour=hour,
        day_of_month=day_of_month,
        month_of_year=month_of_year,
        day_of_week=day_of_week,
    )


def entry_key(task_id: str) -> str:
    return f"linda:cron:{task_id}"


def redis_schedule_key(task_id: str) -> str:
    """Full Redis key under which RedBeat stores an entry — includes the
    app's `redbeat_key_prefix`. `from_key` needs this full form."""
    return RedBeatSchedulerEntry.generate_key(app=celery_app, name=entry_key(task_id))


def meta_key(task_id: str) -> str:
    return f"linda:cron-meta:{task_id}"


_redis_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(CELERY_REDIS_URL, decode_responses=True)
    return _redis_client


def save_meta(task_id: str, cron_schedule: str, timezone: str | None) -> None:
    """Persist the original (local) cron + timezone so GET can return what the
    caller registered, not the UTC-adjusted form RedBeat stores internally."""
    client = get_redis()
    pipe = client.pipeline()
    pipe.delete(meta_key(task_id))
    mapping: dict[str, str] = {"cron_schedule": cron_schedule}
    if timezone:
        mapping["timezone"] = timezone
    pipe.hset(meta_key(task_id), mapping=mapping)
    pipe.execute()


@api.get("/health")
def health():
    return {"status": "ok"}


@api.post("/schedules", status_code=201, dependencies=[Depends(verify_admin_key)])
def create_schedule(body: ScheduleCreate):
    utc_cron = cron_to_utc(body.cron_schedule, body.timezone)
    schedule = parse_crontab(utc_cron)
    entry = RedBeatSchedulerEntry(
        name=entry_key(body.task_id),
        task="linda.execute_task",
        schedule=schedule,
        args=[body.task_id],
        app=celery_app,
    )
    entry.save()
    save_meta(body.task_id, body.cron_schedule, body.timezone)
    return {"task_id": body.task_id, "cron_schedule": body.cron_schedule, "registered": True}


@api.get("/schedules/{task_id}", dependencies=[Depends(verify_admin_key)])
def get_schedule(task_id: str):
    """Return what Celery has stored for this task, or 404.

    Mirrors the shape of POST input so callers can assert the schedule Celery
    actually fires on matches the one sent by the backend.
    """
    key = redis_schedule_key(task_id)
    try:
        RedBeatSchedulerEntry.from_key(key, app=celery_app)
    except KeyError:
        raise HTTPException(status_code=404, detail="Schedule not found")

    meta = get_redis().hgetall(meta_key(task_id))
    return {
        "task_id": task_id,
        "cron_schedule": meta.get("cron_schedule"),
        "timezone": meta.get("timezone") or None,
    }


@api.put("/schedules/{task_id}", dependencies=[Depends(verify_admin_key)])
def update_schedule(task_id: str, body: ScheduleUpdate):
    key = redis_schedule_key(task_id)
    try:
        entry = RedBeatSchedulerEntry.from_key(key, app=celery_app)
    except KeyError:
        raise HTTPException(status_code=404, detail="Schedule not found")

    utc_cron = cron_to_utc(body.cron_schedule, body.timezone)
    entry.schedule = parse_crontab(utc_cron)
    entry.save()
    save_meta(task_id, body.cron_schedule, body.timezone)
    return {"task_id": task_id, "cron_schedule": body.cron_schedule, "updated": True}


@api.delete("/schedules/{task_id}", dependencies=[Depends(verify_admin_key)])
def delete_schedule(task_id: str):
    key = redis_schedule_key(task_id)
    try:
        entry = RedBeatSchedulerEntry.from_key(key, app=celery_app)
        entry.delete()
    except KeyError:
        pass  # Already gone — that's fine
    get_redis().delete(meta_key(task_id))
    return {"task_id": task_id, "deleted": True}


@api.post("/execute-once", status_code=201, dependencies=[Depends(verify_admin_key)])
def execute_once(body: ExecuteOnceBody):
    from datetime import datetime

    eta = datetime.fromisoformat(body.eta.replace("Z", "+00:00"))
    execute_task.apply_async(args=[body.task_id], eta=eta)
    return {"task_id": body.task_id, "eta": body.eta, "scheduled": True}


@api.post("/execute-now", status_code=201, dependencies=[Depends(verify_admin_key)])
def execute_now(body: ExecuteNowBody):
    execute_task.apply_async(args=[body.task_id])
    return {"task_id": body.task_id, "scheduled": True}

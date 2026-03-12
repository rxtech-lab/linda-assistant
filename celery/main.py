from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from celery.schedules import crontab
from redbeat import RedBeatSchedulerEntry
import redbeat
from worker import app as celery_app, execute_task
from config import CELERY_ADMIN_KEY

api = FastAPI(title="Linda Celery Scheduler")


def verify_admin_key(authorization: str = Header(...)):
    expected = f"Bearer {CELERY_ADMIN_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class ScheduleCreate(BaseModel):
    task_id: str
    cron_schedule: str  # e.g. "0 9 * * *"


class ScheduleUpdate(BaseModel):
    cron_schedule: str


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


@api.get("/health")
def health():
    return {"status": "ok"}


@api.post("/schedules", status_code=201, dependencies=[Depends(verify_admin_key)])
def create_schedule(body: ScheduleCreate):
    schedule = parse_crontab(body.cron_schedule)
    entry = RedBeatSchedulerEntry(
        name=entry_key(body.task_id),
        task="linda.execute_task",
        schedule=schedule,
        args=[body.task_id],
        app=celery_app,
    )
    entry.save()
    return {"task_id": body.task_id, "cron_schedule": body.cron_schedule, "registered": True}


@api.put("/schedules/{task_id}", dependencies=[Depends(verify_admin_key)])
def update_schedule(task_id: str, body: ScheduleUpdate):
    key = entry_key(task_id)
    try:
        entry = RedBeatSchedulerEntry.from_key(key, app=celery_app)
    except redbeat.schedulers.RedBeatSchedulerEntry.DoesNotExist:
        raise HTTPException(status_code=404, detail="Schedule not found")
    except Exception:
        raise HTTPException(status_code=404, detail="Schedule not found")

    entry.schedule = parse_crontab(body.cron_schedule)
    entry.save()
    return {"task_id": task_id, "cron_schedule": body.cron_schedule, "updated": True}


@api.delete("/schedules/{task_id}", dependencies=[Depends(verify_admin_key)])
def delete_schedule(task_id: str):
    key = entry_key(task_id)
    try:
        entry = RedBeatSchedulerEntry.from_key(key, app=celery_app)
        entry.delete()
    except Exception:
        pass  # Already gone — that's fine
    return {"task_id": task_id, "deleted": True}

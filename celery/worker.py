import httpx
from celery import Celery
from config import RABBITMQ_URL, CELERY_REDIS_URL, BACKEND_INTERNAL_URL, CELERY_ADMIN_KEY

app = Celery(
    "linda_scheduler",
    broker=RABBITMQ_URL,
    backend=None,
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Use redbeat for persistent beat scheduling
    beat_scheduler="redbeat.RedBeatScheduler",
    redbeat_redis_url=CELERY_REDIS_URL,
    redbeat_key_prefix="linda:celery:beat:",
    # Durable task queue
    task_queues={
        "linda-cron": {
            "exchange": "linda-cron",
            "routing_key": "linda-cron",
            "queue_arguments": {"x-queue-type": "classic"},
            "durable": True,
        }
    },
    task_default_queue="linda-cron",
    task_default_exchange="linda-cron",
    task_default_routing_key="linda-cron",
    # Acknowledge after task completion to prevent loss on crash
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@app.task(name="linda.execute_task", bind=True, max_retries=3, default_retry_delay=60)
def execute_task(self, task_id: str) -> dict:
    """Call the backend execute endpoint for the given task ID."""
    try:
        response = httpx.post(
            f"{BACKEND_INTERNAL_URL}/api/tasks/{task_id}/execute",
            headers={"Authorization": f"Bearer {CELERY_ADMIN_KEY}"},
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        print(f"[Celery] HTTP error executing task {task_id}: {exc.response.status_code}")
        if exc.response.status_code < 500:
            # Client errors (4xx) — don't retry
            return {"error": str(exc)}
        raise self.retry(exc=exc)
    except Exception as exc:
        print(f"[Celery] Error executing task {task_id}: {exc}")
        raise self.retry(exc=exc)

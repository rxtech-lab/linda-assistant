FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN groupadd --system --gid 1001 celery && \
    useradd --system --uid 1001 --no-log-init -g celery celery

USER celery

EXPOSE 8000

# Start FastAPI (API server), Celery beat (redbeat scheduler), and Celery worker
CMD ["sh", "-c", \
  "uvicorn main:api --host 0.0.0.0 --port 8000 & \
   celery -A worker beat -S redbeat.RedBeatScheduler --loglevel=info & \
   celery -A worker worker --loglevel=info --queues=linda-cron"]

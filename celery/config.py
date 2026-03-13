import os

RABBITMQ_URL: str = os.environ["RABBITMQ_URL"]
CELERY_REDIS_URL: str = os.environ["CELERY_REDIS_URL"]
BACKEND_INTERNAL_URL: str = os.environ["BACKEND_INTERNAL_URL"]
CELERY_ADMIN_KEY: str = os.environ["CELERY_ADMIN_KEY"]

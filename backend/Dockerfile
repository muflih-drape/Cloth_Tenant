FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libjpeg-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN SECRET_KEY=build DEBUG=False ALLOWED_HOSTS=build \
    DB_NAME=x DB_USER=x DB_PASSWORD=x DB_HOST=x DB_PORT=5432 \
    python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn --bind=0.0.0.0:8000 --workers=2 --timeout=120 --access-logfile - --error-logfile - config.wsgi:application"]

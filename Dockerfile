FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DATA_DIR=/app/data

WORKDIR /app

RUN addgroup -S ourspace && adduser -S ourspace -G ourspace

COPY --chown=ourspace:ourspace app.py ./
COPY --chown=ourspace:ourspace ourspace ./ourspace
COPY --chown=ourspace:ourspace static ./static
RUN mkdir -p /app/data && chown -R ourspace:ourspace /app

USER ourspace
EXPOSE 8000

HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

CMD ["python", "app.py"]

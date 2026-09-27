FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git nodejs npm ffmpeg chromium \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
USER 10000:10000
CMD ["sleep", "infinity"]

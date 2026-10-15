FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir -r requirements.txt
ENV U2NET_HOME=/app/backend/.runtime/models OMP_NUM_THREADS=2 FELT_MODEL=isnet-general-use PYTHONDONTWRITEBYTECODE=1 \
    NUMBA_CACHE_DIR=/app/backend/.runtime/cache/numba XDG_CACHE_HOME=/app/backend/.runtime/cache
ARG FELT_PRELOAD_MODEL=1
RUN case "$FELT_PRELOAD_MODEL" in \
      1) python -c "import os; from rembg import new_session; new_session(os.environ['FELT_MODEL'])" ;; \
      0) : ;; \
      *) echo 'FELT_PRELOAD_MODEL must be 0 or 1' >&2; exit 1 ;; \
    esac
RUN mkdir -p /app/backend/.runtime/cutouts /app/backend/.runtime/cache/numba && chown -R 10001:10001 /app/backend/.runtime
COPY backend ./backend
USER 10001:10001
EXPOSE 8787
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8787"]

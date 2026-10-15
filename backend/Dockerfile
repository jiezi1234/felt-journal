FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
ENV U2NET_HOME=/app/backend/.runtime/models OMP_NUM_THREADS=2 FELT_MODEL=isnet-general-use PYTHONDONTWRITEBYTECODE=1
RUN python -c "import os; from rembg import new_session; new_session(os.environ['FELT_MODEL'])"
RUN mkdir -p /app/backend/.runtime/cutouts && chown -R 10001:10001 /app/backend/.runtime
USER 10001:10001
EXPOSE 8787
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8787"]

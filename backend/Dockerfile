FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80felt-download \
    && apt-get update && apt-get install -y --no-install-recommends libgomp1 patchelf && rm -rf /var/lib/apt/lists/*
# MNN 3.6.1 Linux wheels mark their ELF stack executable, which glibc 2.41
# rejects on import. Clear that flag and verify imports during the build.
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from importlib.metadata import distribution; import subprocess; d = distribution('MNN'); libs = [str(d.locate_file(f)) for f in d.files if str(f).endswith('.so')]; assert libs, 'MNN shared libraries missing'; subprocess.run(['patchelf', '--clear-execstack', *libs], check=True)" \
    && python -c "import MNN.expr; import MNN.nn"
ARG FELT_MODEL=nosh-mnn
ENV U2NET_HOME=/app/backend/.runtime/models OMP_NUM_THREADS=2 FELT_MODEL=${FELT_MODEL} PYTHONDONTWRITEBYTECODE=1 \
    NUMBA_CACHE_DIR=/app/backend/.runtime/cache/numba XDG_CACHE_HOME=/app/backend/.runtime/cache
ARG FELT_PRELOAD_MODEL=1
RUN case "$FELT_PRELOAD_MODEL" in \
      1) if [ "$FELT_MODEL" != nosh-mnn ]; then python -c "import os; from rembg import new_session; new_session(os.environ['FELT_MODEL'])"; fi ;; \
      0) : ;; \
      *) echo 'FELT_PRELOAD_MODEL must be 0 or 1' >&2; exit 1 ;; \
    esac
RUN mkdir -p /app/backend/.runtime/cutouts /app/backend/.runtime/nosh /app/backend/.runtime/cache/numba && chown -R 10001:10001 /app/backend/.runtime
COPY backend ./backend
USER 10001:10001
EXPOSE 8787
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8787"]

# Acoustics service — Python 3.12 (Parselmouth has no 3.14 wheel).
#
# praat-parselmouth ships no linux/arm64 wheel, so on Apple Silicon pip must
# compile it from source. The builder stage carries the C++/CMake/Ninja
# toolchain; the runtime stage stays slim (ffmpeg + the built venv only).

FROM python:3.12-slim-bookworm AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     build-essential cmake ninja-build \
  && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# parselmouth 0.4.5 bundles an old pybind11 whose cmake_minimum_required
# predates 3.5, which CMake 4.x refuses. Allow the legacy policy version.
ENV CMAKE_POLICY_VERSION_MINIMUM=3.5

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
COPY --from=builder /opt/venv /opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /app

COPY analysis.py main.py sweeper.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

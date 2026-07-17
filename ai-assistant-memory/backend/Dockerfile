# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends gcc build-essential && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY backend/requirements.txt ./
RUN pip install --upgrade pip && pip install --user -r requirements.txt

# Copy source code
COPY backend ./backend

# Runtime stage
FROM python:3.13-slim AS runtime
WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application code
COPY --from=builder /app/backend ./backend

# Expose port for FastAPI
EXPOSE 8000

# Command to run
CMD ["python", "-m", "uvicorn", "backend/app/main:app", "--host", "0.0.0.0", "--port", "8000"]

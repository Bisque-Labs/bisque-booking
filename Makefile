.PHONY: dev test docker-up docker-down docker-test migrate lint fmt help

## Start the app locally with hot-reload (requires local Postgres running)
dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

## Run tests (requires Python deps installed)
test:
	pytest -v --tb=short

## Run tests with coverage
test-cov:
	pytest -v --tb=short --cov=app --cov-report=term-missing

## Start the full Docker Compose stack (app + postgres + mailpit)
docker-up:
	docker compose up --build

## Start in detached mode
docker-up-d:
	docker compose up --build -d

## Stop Docker Compose
docker-down:
	docker compose down

## Run tests in Docker
docker-test:
	docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests

## Run database migrations
migrate:
	alembic upgrade head

## Create a new migration (autogenerate)
migration:
	alembic revision --autogenerate -m "$(MSG)"

## Install Python deps (dev)
install:
	pip install -r requirements-dev.txt

## Format code
fmt:
	ruff format app tests

## Lint code
lint:
	ruff check app tests

## Show help
help:
	@echo "bisque-booking Makefile"
	@echo ""
	@echo "Targets:"
	@grep -E '^## ' Makefile | sed 's/## /  /'

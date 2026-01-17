.PHONY: lint validate security-scan integration ci dashboard-dev dashboard-build dashboard-test

# Dashboard directory
DASHBOARD_DIR := services/dashboard

lint:
	yamllint -c .yamllint.yml .
	find . -name "*.sh" -exec shellcheck {} +

validate:
	docker compose --profile lite config --quiet
	docker compose --profile core config --quiet
	docker compose --profile full config --quiet

security-scan:
	trivy config .
	trivy fs --severity CRITICAL .

integration:
	docker compose --profile lite up -d --wait
	docker compose --profile lite ps
	docker compose --profile lite down -v

ci: lint validate security-scan
	@echo "All CI checks passed locally"

# Dashboard targets
dashboard-dev:
	@echo "Starting dashboard in development mode..."
	cd $(DASHBOARD_DIR) && go run main.go

dashboard-build:
	@echo "Building dashboard binary..."
	cd $(DASHBOARD_DIR) && go build -o dashboard main.go
	@echo "Binary built: $(DASHBOARD_DIR)/dashboard"

dashboard-test:
	@echo "Running dashboard tests..."
	cd $(DASHBOARD_DIR) && go test -v ./...

dashboard-docker:
	@echo "Building dashboard Docker image..."
	docker build -t peermesh/dashboard:latest $(DASHBOARD_DIR)

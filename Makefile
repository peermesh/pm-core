.PHONY: lint validate security-scan integration ci

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

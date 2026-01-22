#!/bin/bash
# ==============================================================
# Mastodon Module - Health Check Hook
# ==============================================================
# Purpose: Check health of all Mastodon services
# Called: By pmdl status or monitoring systems
#
# Output: JSON health status for dashboard integration
#
# Exit codes:
#   0 - All services healthy
#   1 - One or more services unhealthy
#   2 - Services not running
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Output format (json or text)
OUTPUT_FORMAT="${1:-text}"

# ==============================================================
# Health Check Functions
# ==============================================================

check_container_health() {
    local container="$1"
    local status

    # Check if container exists and is running
    if ! docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        echo "not_running"
        return 2
    fi

    # Check Docker health status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no_healthcheck")

    case "$status" in
        "healthy")
            echo "healthy"
            return 0
            ;;
        "unhealthy")
            echo "unhealthy"
            return 1
            ;;
        "starting")
            echo "starting"
            return 0
            ;;
        *)
            # No health check - verify it's running
            if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
                echo "running"
                return 0
            else
                echo "unknown"
                return 1
            fi
            ;;
    esac
}

check_web_health() {
    local container="pmdl_mastodon_web"
    local container_status
    container_status=$(check_container_health "$container")
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo "$container_status"
        return $exit_code
    fi

    # Additional HTTP health check
    if docker exec "$container" wget -q --spider http://localhost:3000/health 2>/dev/null; then
        echo "healthy"
        return 0
    else
        echo "unhealthy"
        return 1
    fi
}

check_streaming_health() {
    local container="pmdl_mastodon_streaming"
    local container_status
    container_status=$(check_container_health "$container")
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo "$container_status"
        return $exit_code
    fi

    # Additional HTTP health check
    if docker exec "$container" wget -q --spider http://localhost:4000/api/v1/streaming/health 2>/dev/null; then
        echo "healthy"
        return 0
    else
        echo "unhealthy"
        return 1
    fi
}

check_sidekiq_health() {
    local container="pmdl_mastodon_sidekiq"
    local container_status
    container_status=$(check_container_health "$container")
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo "$container_status"
        return $exit_code
    fi

    # Check if sidekiq process is running
    if docker exec "$container" ps aux 2>/dev/null | grep -q "[s]idekiq"; then
        echo "healthy"
        return 0
    else
        echo "unhealthy"
        return 1
    fi
}

check_opensearch_health() {
    local container="pmdl_mastodon_opensearch"
    local container_status
    container_status=$(check_container_health "$container")
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo "$container_status"
        return $exit_code
    fi

    # Check cluster health
    local cluster_status
    cluster_status=$(docker exec "$container" curl -s http://localhost:9200/_cluster/health 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    case "$cluster_status" in
        "green"|"yellow")
            echo "healthy"
            return 0
            ;;
        "red")
            echo "degraded"
            return 1
            ;;
        *)
            echo "unknown"
            return 1
            ;;
    esac
}

check_database_connection() {
    local container="pmdl_mastodon_web"

    if ! docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        echo "not_checked"
        return 0
    fi

    # Check if Rails can connect to database
    if docker exec "$container" bundle exec rails runner "ActiveRecord::Base.connection.active?" 2>/dev/null; then
        echo "connected"
        return 0
    else
        echo "disconnected"
        return 1
    fi
}

check_redis_connection() {
    local container="pmdl_mastodon_web"

    if ! docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        echo "not_checked"
        return 0
    fi

    # Check if Rails can connect to Redis
    if docker exec "$container" bundle exec rails runner "Redis.new.ping" 2>/dev/null; then
        echo "connected"
        return 0
    else
        echo "disconnected"
        return 1
    fi
}

get_instance_stats() {
    local container="pmdl_mastodon_web"

    if ! docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        echo '{"users": 0, "statuses": 0, "domains": 0}'
        return
    fi

    # Get instance statistics via tootctl
    local users statuses domains

    users=$(docker exec "$container" tootctl accounts list 2>/dev/null | wc -l || echo "0")
    users=$((users > 0 ? users - 1 : 0))  # Subtract header line

    # These require database queries, so we'll use placeholders if unavailable
    statuses=$(docker exec "$container" bundle exec rails runner "puts Status.count" 2>/dev/null || echo "0")
    domains=$(docker exec "$container" bundle exec rails runner "puts Instance.count" 2>/dev/null || echo "0")

    echo "{\"users\": ${users}, \"statuses\": ${statuses}, \"domains\": ${domains}}"
}

# ==============================================================
# Output Functions
# ==============================================================

output_json() {
    local web_status="$1"
    local streaming_status="$2"
    local sidekiq_status="$3"
    local opensearch_status="$4"
    local db_status="$5"
    local redis_status="$6"
    local overall_status="$7"
    local stats="$8"

    cat << EOF
{
  "module": "mastodon",
  "version": "1.0.0",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "status": "${overall_status}",
  "services": {
    "web": {
      "status": "${web_status}",
      "container": "pmdl_mastodon_web",
      "port": 3000
    },
    "streaming": {
      "status": "${streaming_status}",
      "container": "pmdl_mastodon_streaming",
      "port": 4000
    },
    "sidekiq": {
      "status": "${sidekiq_status}",
      "container": "pmdl_mastodon_sidekiq"
    },
    "opensearch": {
      "status": "${opensearch_status}",
      "container": "pmdl_mastodon_opensearch",
      "port": 9200
    }
  },
  "connections": {
    "database": "${db_status}",
    "redis": "${redis_status}"
  },
  "stats": ${stats}
}
EOF
}

output_text() {
    local web_status="$1"
    local streaming_status="$2"
    local sidekiq_status="$3"
    local opensearch_status="$4"
    local db_status="$5"
    local redis_status="$6"
    local overall_status="$7"

    # Colors
    local RED='\033[0;31m'
    local GREEN='\033[0;32m'
    local YELLOW='\033[1;33m'
    local NC='\033[0m'

    status_color() {
        case "$1" in
            "healthy"|"connected"|"running")
                echo -e "${GREEN}$1${NC}"
                ;;
            "unhealthy"|"disconnected"|"not_running")
                echo -e "${RED}$1${NC}"
                ;;
            *)
                echo -e "${YELLOW}$1${NC}"
                ;;
        esac
    }

    echo "========================================"
    echo "Mastodon Module Health Check"
    echo "========================================"
    echo ""
    echo "Services:"
    echo "  Web:         $(status_color "$web_status")"
    echo "  Streaming:   $(status_color "$streaming_status")"
    echo "  Sidekiq:     $(status_color "$sidekiq_status")"
    echo "  OpenSearch:  $(status_color "$opensearch_status")"
    echo ""
    echo "Connections:"
    echo "  Database:    $(status_color "$db_status")"
    echo "  Redis:       $(status_color "$redis_status")"
    echo ""
    echo "Overall:       $(status_color "$overall_status")"
    echo "========================================"
}

# ==============================================================
# Main
# ==============================================================

main() {
    # Check all services
    local web_status streaming_status sidekiq_status opensearch_status
    local db_status redis_status

    web_status=$(check_web_health)
    streaming_status=$(check_streaming_health)
    sidekiq_status=$(check_sidekiq_health)
    opensearch_status=$(check_opensearch_health)
    db_status=$(check_database_connection)
    redis_status=$(check_redis_connection)

    # Determine overall status
    local overall_status="healthy"
    local exit_code=0

    # Check for unhealthy services
    if [[ "$web_status" == "unhealthy" ]] || [[ "$web_status" == "not_running" ]]; then
        overall_status="unhealthy"
        exit_code=1
    elif [[ "$streaming_status" == "unhealthy" ]] || [[ "$streaming_status" == "not_running" ]]; then
        overall_status="unhealthy"
        exit_code=1
    elif [[ "$sidekiq_status" == "unhealthy" ]] || [[ "$sidekiq_status" == "not_running" ]]; then
        overall_status="unhealthy"
        exit_code=1
    fi

    # Degraded if OpenSearch is down (search won't work but instance runs)
    if [[ "$opensearch_status" == "unhealthy" ]] || [[ "$opensearch_status" == "not_running" ]]; then
        if [[ "$overall_status" == "healthy" ]]; then
            overall_status="degraded"
        fi
    fi

    # Check connection issues
    if [[ "$db_status" == "disconnected" ]] || [[ "$redis_status" == "disconnected" ]]; then
        overall_status="unhealthy"
        exit_code=1
    fi

    # Not running if all services are down
    if [[ "$web_status" == "not_running" ]] && [[ "$streaming_status" == "not_running" ]] && [[ "$sidekiq_status" == "not_running" ]]; then
        overall_status="not_running"
        exit_code=2
    fi

    # Get stats for JSON output
    local stats
    stats=$(get_instance_stats)

    # Output results
    case "$OUTPUT_FORMAT" in
        "json")
            output_json "$web_status" "$streaming_status" "$sidekiq_status" "$opensearch_status" "$db_status" "$redis_status" "$overall_status" "$stats"
            ;;
        *)
            output_text "$web_status" "$streaming_status" "$sidekiq_status" "$opensearch_status" "$db_status" "$redis_status" "$overall_status"
            ;;
    esac

    exit $exit_code
}

main "$@"

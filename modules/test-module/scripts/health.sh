#!/bin/bash
#
# test-module: Health check script
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy
#   2 - Degraded

MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Track overall status
overall_status="healthy"
exit_code=0
checks=()

# Check 1: Module configuration exists
check_config() {
    if [ -f "$MODULE_DIR/module.json" ]; then
        echo '{"name":"config","status":"pass","message":"module.json exists"}'
        return 0
    else
        echo '{"name":"config","status":"fail","message":"module.json missing"}'
        return 1
    fi
}

# Check 2: Data directory accessible
check_data() {
    local data_dir="$MODULE_DIR/data"
    if [ -d "$data_dir" ] && [ -w "$data_dir" ]; then
        echo '{"name":"data","status":"pass","message":"data directory accessible"}'
        return 0
    else
        echo '{"name":"data","status":"fail","message":"data directory not accessible"}'
        return 1
    fi
}

# Check 3: Container health (if docker available)
check_container() {
    if command -v docker &> /dev/null; then
        cd "$MODULE_DIR"
        local container_status
        container_status=$(docker compose ps --format json 2>/dev/null | jq -r '.[0].Health // "none"' 2>/dev/null || echo "unavailable")

        case "$container_status" in
            "healthy")
                echo '{"name":"container","status":"pass","message":"container healthy"}'
                return 0
                ;;
            "starting")
                echo '{"name":"container","status":"warn","message":"container starting"}'
                return 2
                ;;
            "unhealthy")
                echo '{"name":"container","status":"fail","message":"container unhealthy"}'
                return 1
                ;;
            "none"|"unavailable"|*)
                echo '{"name":"container","status":"warn","message":"container not running or unavailable"}'
                return 2
                ;;
        esac
    else
        echo '{"name":"container","status":"warn","message":"docker not available"}'
        return 2
    fi
}

# Run checks
config_check=$(check_config)
config_exit=$?
if [ $config_exit -eq 1 ]; then
    overall_status="unhealthy"
    exit_code=1
fi
checks+=("$config_check")

data_check=$(check_data)
data_exit=$?
if [ $data_exit -eq 1 ]; then
    if [ "$overall_status" = "healthy" ]; then
        overall_status="degraded"
        exit_code=2
    fi
fi
checks+=("$data_check")

container_check=$(check_container)
container_exit=$?
if [ $container_exit -eq 1 ]; then
    overall_status="unhealthy"
    exit_code=1
elif [ $container_exit -eq 2 ] && [ "$overall_status" = "healthy" ]; then
    overall_status="degraded"
    exit_code=2
fi
checks+=("$container_check")

# Format checks array as JSON
checks_json=$(printf '%s\n' "${checks[@]}" | jq -s '.')

# Output JSON
timestamp=$(date +%s000)
jq -n \
    --arg status "$overall_status" \
    --argjson checks "$checks_json" \
    --argjson timestamp "$timestamp" \
    '{
        "status": $status,
        "message": (if $status == "healthy" then "All systems operational" elif $status == "degraded" then "Some checks have warnings" else "Health check failed" end),
        "checks": $checks,
        "timestamp": $timestamp
    }'

exit $exit_code

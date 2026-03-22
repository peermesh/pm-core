# Security Tests

This directory contains security test templates for module authors. These tests verify that your module's endpoints follow baseline security expectations.

## Test Scripts

| Script | Purpose |
|--------|---------|
| `test-auth-bypass.sh` | Verifies protected endpoints reject unauthenticated requests |
| `test-header-injection.sh` | Verifies endpoints do not reflect injected headers |

## Usage

All test scripts accept a base URL as their first argument:

```bash
./tests/security/test-auth-bypass.sh http://localhost:8080
./tests/security/test-header-injection.sh http://localhost:8080
```

Exit code 0 means all checks passed. Non-zero means at least one check failed.

## Customizing for Your Module

### Endpoint Sanitization Testing

Edit `test-auth-bypass.sh` and update the `PROTECTED_ENDPOINTS` array with your module's actual protected routes:

```bash
PROTECTED_ENDPOINTS=(
    "/api/users"
    "/api/settings"
    "/admin/dashboard"
    "/internal/metrics"
)
```

Every endpoint in this list is tested without authentication. The test passes if the endpoint returns 401 (Unauthorized), 403 (Forbidden), or 302 (redirect to login).

### Auth Bypass Test Structure

The auth bypass test follows a simple pattern:

1. Define a list of endpoints that require authentication.
2. Send a plain HTTP request with no credentials.
3. Assert the response status code indicates access was denied.

To add more sophisticated bypass attempts, extend the script with additional curl calls:

```bash
# Test with expired/invalid token
status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer invalid-token-here" \
    "${BASE_URL}/api/data")

# Test with empty auth header
status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: " \
    "${BASE_URL}/api/data")
```

### Adding Your Own Security Tests

Common patterns to test for:

**SQL Injection** -- Send payloads like `' OR '1'='1` in query parameters and form fields. Verify the application returns an error or sanitized response, not database results.

**Path Traversal** -- Request paths like `/api/files/../../etc/passwd`. Verify the application returns 400 or 404, not file contents.

**CORS Misconfiguration** -- Send requests with `Origin: https://evil.com` and check that `Access-Control-Allow-Origin` does not reflect arbitrary origins.

**Rate Limiting** -- Send rapid sequential requests to a single endpoint and verify the application eventually returns 429 (Too Many Requests).

## Integration with CI

These scripts use only `curl` and `bash`, making them suitable for CI pipelines:

```yaml
# Example GitHub Actions step
- name: Security smoke tests
  run: |
    ./tests/security/test-auth-bypass.sh http://localhost:8080
    ./tests/security/test-header-injection.sh http://localhost:8080
```

## Integration with mitmproxy

For deeper inspection, combine these tests with the `dev-security` profile (see `profiles/dev-security/README.md`). Run the test scripts while mitmproxy is active to capture and analyze every request and response in the web UI at `http://localhost:8081`.

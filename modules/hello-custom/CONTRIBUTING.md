# Contributing to Hello Module

Thank you for your interest in improving the Hello Module example. This repository serves as a reference implementation for the PeerMesh Docker Lab module system, so clarity and correctness are the top priorities.

## How to Contribute

### Reporting Issues

If you find a bug, unclear documentation, or something that does not work as described:

1. Check [existing issues](https://github.com/peermesh/hello-module/issues) to avoid duplicates
2. Open a new issue with:
   - A clear title describing the problem
   - Steps to reproduce
   - Expected vs. actual behavior
   - Your Docker Lab version and OS

### Suggesting Improvements

Ideas for making the example clearer or more useful are welcome:

1. Open an issue describing the improvement
2. Explain why the change would help module authors
3. If possible, reference the Docker Lab documentation that supports your suggestion

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes following the guidelines below
4. Test your changes (run the smoke test)
5. Submit a pull request with a clear description

## Guidelines

### Code Style

- Shell scripts use `bash` with `set -euo pipefail`
- Use the logging functions (`log`, `log_success`, `log_error`) for consistent output
- Follow the existing indentation (2 spaces for YAML, 4 spaces for shell scripts)
- Keep `# CUSTOMIZE:` comments on lines that module authors should change

### What Makes a Good Change

- **Clarity over cleverness.** This is a teaching example. Straightforward code is better than elegant code.
- **Annotated changes.** If you add a new pattern, explain it with comments.
- **Backward compatible.** Changes should not break existing Docker Lab deployments.
- **Tested.** Run `tests/smoke-test.sh` before submitting.

### What We Cannot Accept

- Changes that add complexity without educational value
- Dependencies on external services (the example should work with only Docker Lab foundation)
- Secrets or credentials in any form

## Testing

Before submitting, verify your changes work:

```bash
# Start the module
docker compose up -d

# Run the smoke test
./tests/smoke-test.sh

# Run the health check
./hooks/health.sh json
```

## Questions?

If you are unsure whether a change is appropriate, open an issue first to discuss it.

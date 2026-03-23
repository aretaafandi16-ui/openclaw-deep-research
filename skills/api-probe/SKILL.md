---
name: api-probe
description: Probe and validate HTTP API endpoints. Use when checking API health, testing endpoint responses, validating status codes, measuring latency, or verifying JSON response structure. Supports single endpoint checks and batch validation from JSON config. Triggered by phrases like "check if API is up", "test endpoint", "probe URL", "health check API", "validate API response".
---

# API Probe

Lightweight API testing and health-check tooling. No dependencies beyond `curl` and `jq`.

## Quick Start

```bash
# Basic probe
bash scripts/probe.sh https://api.example.com/health

# With status validation
bash scripts/probe.sh -e 200 https://api.example.com/health

# POST with body and JSON validation
bash scripts/probe.sh -m POST -d '{"key":"val"}' -H "Content-Type: application/json" -e 201 -j '.id' https://api.example.com/data
```

## Single Endpoint: `probe.sh`

| Flag | Description | Example |
|------|-------------|---------|
| `-m` | HTTP method | `-m POST` |
| `-H` | Header (repeatable) | `-H "Auth: Bearer xyz"` |
| `-d` | Body (string or `@file`) | `-d '{"x":1}'` |
| `-t` | Timeout in seconds | `-t 5` |
| `-e` | Expected status code | `-e 200` |
| `-j` | jq filter to validate | `-j '.data[0].id'` |
| `-c` | Check JSON validity | `-c` |
| `-q` | Quiet: print `0` (pass) or `1` (fail) | `-q` |
| `-s` | Silent: no output, exit code only | `-s` |

Exit code `0` = all validations passed, `1` = failure.

**Output includes:** HTTP status, response time, body size, validation results, and response body (truncated at 10KB).

## Batch Probe: `batch-probe.sh`

Test multiple endpoints from a JSON config:

```bash
bash scripts/batch-probe.sh endpoints.json
```

Config format (`endpoints.json`):
```json
[
  {
    "url": "https://api.example.com/health",
    "expect": 200
  },
  {
    "url": "https://api.example.com/data",
    "method": "POST",
    "headers": {"Content-Type": "application/json"},
    "data": "{\"query\": \"test\"}",
    "expect": 200,
    "jq": ".results | length > 0"
  }
]
```

## Common Patterns

### Health Check
```bash
bash scripts/probe.sh -e 200 -q https://api.example.com/health
# Returns 0 if healthy, 1 if not
```

### Latency Monitoring
```bash
bash scripts/probe.sh -t 3 https://api.example.com/
# Check the "Time:" output — slow if > 2s
```

### Response Schema Validation
```bash
bash scripts/probe.sh -j '.users | type == "array"' -e 200 https://api.example.com/users
```

### Smoke Test After Deploy
```bash
bash scripts/batch-probe.sh post-deploy-checks.json
```

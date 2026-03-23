# tool-bridge

**Universal bridge that turns any REST API or CLI tool into MCP tools via YAML config.**

Like Zapier for MCP — define endpoints, get tools. Zero code required.

## Features

- **REST API → MCP tools** via YAML/JSON config
- **CLI wrappers** — expose any CLI command as an MCP tool
- **Auth support** — Bearer, Basic, API Key, OAuth2, custom headers
- **Response transforms** — JSONPath extraction, field mapping
- **Rate limiting** — per-tool configurable limits
- **Response caching** — TTL-based cache for repeated calls
- **Built-in presets** — GitHub, Linear, Notion, Slack, Discord ready
- **Template variables** — `{{env.VAR}}`, `{{args.key}}`, `{{date.now}}`
- **Batch operations** — call multiple tools in one request

## Quick Start

```bash
# Install (zero deps!)
cd tool-bridge

# Run with built-in presets
node cli.mjs list                    # List available tools
node cli.mjs call github_repos       # Call a tool
node cli.mjs serve                   # Start MCP server

# Create custom config
cat > my-tools.yaml << 'EOF'
tools:
  weather:
    description: Get weather for a city
    type: rest
    method: GET
    url: https://wttr.in/{{args.city}}?format=j1
    params:
      format: j1
    transform:
      temp: current_condition[0].temp_C
      desc: current_condition[0].weatherDesc[0].value
  
  disk_usage:
    description: Check disk usage
    type: cli
    command: df -h {{args.partition || "/"}}
    timeout: 5000
EOF

node cli.mjs serve --config my-tools.yaml
```

## MCP Server

Start the MCP server for integration with OpenClaw or other MCP clients:

```bash
node mcp-server.mjs [--config path/to/config.yaml] [--port 3100]
```

## Config Format

```yaml
# tools.yaml
defaults:
  timeout: 10000
  rateLimit: 60  # requests per minute
  cache: 300     # seconds

tools:
  tool_name:
    description: "What this tool does"
    type: rest | cli
    
    # REST type
    method: GET | POST | PUT | DELETE | PATCH
    url: "https://api.example.com/endpoint"
    headers:
      Authorization: "Bearer {{env.API_TOKEN}}"
    params:
      key: "{{args.api_key}}"
    body:
      field: "{{args.value}}"
    transform:
      result_field: "json.path.to.value"
    
    # CLI type  
    command: "some-cli {{args.flag}}"
    cwd: "/optional/working/dir"
    env:
      VAR: value

  # Dynamic URL patterns
  github_repo:
    description: Get repo info
    type: rest
    method: GET
    url: "https://api.github.com/repos/{{args.owner}}/{{args.repo}}"
    headers:
      Authorization: "Bearer {{env.GITHUB_TOKEN}}"
      Accept: "application/vnd.github.v3+json"
    transform:
      name: name
      stars: stargazers_count
      language: language
      description: description
```

## Template Variables

- `{{args.key}}` — arguments passed to the tool call
- `{{env.VAR_NAME}}` — environment variables
- `{{date.now}}` — ISO timestamp
- `{{date.unix}}` — Unix timestamp
- `{{uuid}}` — random UUID
- `{{response.field}}` — reference previous response in batch

## CLI Reference

```bash
node cli.mjs list                          # List all configured tools
node cli.mjs call <tool> [args]            # Call a tool
node cli.mjs call <tool> --json '{"k":"v"}'  # Call with JSON args
node cli.mjs validate [config]             # Validate config file
node cli.mjs info <tool>                   # Show tool details
node cli.mjs serve [--config] [--port]     # Start MCP server
node cli.mjs presets                       # List available presets
node cli.mjs preset <name>                 # Show preset config
```

## Programmatic API

```javascript
import { ToolBridge } from './index.mjs';

const bridge = new ToolBridge({ config: 'tools.yaml' });
await bridge.load();

// List tools
const tools = bridge.list();

// Call a tool
const result = await bridge.call('weather', { city: 'Jakarta' });
console.log(result); // { temp: "28", desc: "Sunny" }

// With caching
const cached = await bridge.call('weather', { city: 'Jakarta' }, { cache: true });
```

## MCP Tools Exposed

The MCP server exposes these tools:

- `bridge_list` — List all configured tools and their descriptions
- `bridge_call` — Call a specific tool by name with arguments
- `bridge_batch` — Call multiple tools in one request
- `bridge_info` — Get detailed info about a tool (params, auth, etc.)
- `bridge_reload` — Reload configuration without restart

## License

MIT

#!/usr/bin/env node
/**
 * tool-bridge MCP Server
 * Exposes configured REST/CLI tools as MCP tools via stdio transport.
 * Zero dependencies.
 */

import { ToolBridge } from './index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── MCP Protocol ───────────────────────────────────────────────────────────
const SERVER_INFO = {
  name: 'tool-bridge',
  version: '1.0.0',
};

class MCPServer {
  constructor(bridge) {
    this.bridge = bridge;
    this.buffer = '';
  }
  
  async start() {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      this.buffer += chunk;
      this.processBuffer();
    });
    process.stdin.on('end', () => process.exit(0));
  }
  
  processBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      
      const header = this.buffer.substring(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.substring(headerEnd + 4);
        continue;
      }
      
      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      
      if (this.buffer.length < bodyStart + contentLength) break;
      
      const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.substring(bodyStart + contentLength);
      
      try {
        const msg = JSON.parse(body);
        this.handleMessage(msg);
      } catch (e) {
        // ignore parse errors
      }
    }
  }
  
  respond(id, result) {
    const response = JSON.stringify({ jsonrpc: '2.0', id, result });
    const header = `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n`;
    process.stdout.write(header + response);
  }
  
  respondError(id, code, message) {
    const response = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    const header = `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n`;
    process.stdout.write(header + response);
  }
  
  async handleMessage(msg) {
    const { id, method, params } = msg;
    
    try {
      switch (method) {
        case 'initialize':
          this.respond(id, {
            protocolVersion: '2024-11-05',
            serverInfo: SERVER_INFO,
            capabilities: { tools: {} },
          });
          break;
          
        case 'notifications/initialized':
          // No response needed
          break;
          
        case 'tools/list':
          this.respond(id, { tools: this.getToolDefs() });
          break;
          
        case 'tools/call':
          const result = await this.callTool(params);
          this.respond(id, result);
          break;
          
        default:
          this.respondError(id, -32601, `Unknown method: ${method}`);
      }
    } catch (err) {
      this.respondError(id, -32000, err.message);
    }
  }
  
  getToolDefs() {
    const tools = [
      {
        name: 'bridge_list',
        description: 'List all configured tools and their descriptions',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'bridge_call',
        description: 'Call a configured tool by name',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Tool name' },
            args: { type: 'object', description: 'Tool arguments' },
          },
          required: ['tool'],
        },
      },
      {
        name: 'bridge_batch',
        description: 'Call multiple tools in sequence',
        inputSchema: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: 'Array of {tool, args} objects',
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string' },
                  args: { type: 'object' },
                },
                required: ['tool'],
              },
            },
            chain: { type: 'boolean', description: 'Pass previous response to next call' },
          },
          required: ['calls'],
        },
      },
      {
        name: 'bridge_info',
        description: 'Get detailed info about a tool',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Tool name' },
          },
          required: ['tool'],
        },
      },
      {
        name: 'bridge_reload',
        description: 'Reload tool configuration',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
    
    // Add user-configured tools as MCP tools
    for (const [name, def] of Object.entries(this.bridge.config.tools || {})) {
      tools.push({
        name: `tb_${name}`,
        description: def.description || `Tool: ${name}`,
        inputSchema: {
          type: 'object',
          properties: {
            args: {
              type: 'object',
              description: 'Arguments to pass to the tool',
              additionalProperties: true,
            },
          },
        },
      });
    }
    
    return tools;
  }
  
  async callTool(params) {
    const { name, arguments: args } = params;
    
    // Bridge meta-tools
    if (name === 'bridge_list') {
      const tools = this.bridge.list();
      return {
        content: [{ type: 'text', text: JSON.stringify(tools, null, 2) }],
      };
    }
    
    if (name === 'bridge_call') {
      const tool = args?.tool;
      const toolArgs = args?.args || {};
      if (!tool) throw new Error('Missing "tool" parameter');
      
      const result = await this.bridge.call(tool, toolArgs);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    
    if (name === 'bridge_batch') {
      const calls = args?.calls || [];
      const chain = args?.chain || false;
      
      const results = await this.bridge.batch(calls, { chainResponses: chain });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    }
    
    if (name === 'bridge_info') {
      const tool = args?.tool;
      if (!tool) throw new Error('Missing "tool" parameter');
      
      const info = this.bridge.info(tool);
      return {
        content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
      };
    }
    
    if (name === 'bridge_reload') {
      await this.bridge.load();
      const count = Object.keys(this.bridge.config.tools || {}).length;
      return {
        content: [{ type: 'text', text: `Reloaded ${count} tools` }],
      };
    }
    
    // User-configured tool (tb_* prefix)
    if (name.startsWith('tb_')) {
      const toolName = name.slice(3);
      const toolArgs = args?.args || {};
      
      const result = await this.bridge.call(toolName, toolArgs);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    
    throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── CLI Entry ───────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  let configPath = null;
  
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = argv[++i];
    }
  }
  
  const bridge = new ToolBridge({ config: configPath });
  await bridge.load(configPath);
  
  const toolCount = Object.keys(bridge.config.tools || {}).length;
  process.stderr.write(`tool-bridge MCP server: ${toolCount} tools loaded\n`);
  
  const server = new MCPServer(bridge);
  await server.start();
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});

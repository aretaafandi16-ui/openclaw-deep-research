#!/usr/bin/env node
/**
 * tool-bridge CLI
 * Zero dependencies. Node 18+.
 */

import { ToolBridge } from './index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PRESETS_DIR = new URL('./presets', import.meta.url).pathname;

function usage() {
  console.log(`
tool-bridge — Turn REST APIs & CLI into MCP tools

USAGE
  tool-bridge <command> [options]

COMMANDS
  list                     List all configured tools
  call <tool> [args]       Call a tool
  call <tool> --json '{}'  Call with JSON args
  info <tool>              Show tool details
  validate [config]        Validate config file
  presets                  List available presets
  preset <name>            Show preset config
  serve [--config]         Start MCP server
  help                     Show this help

OPTIONS
  --config <path>          Config file (YAML/JSON)
  --json <json>            Arguments as JSON
  --no-cache               Disable caching
  --preset <name>          Load a preset before config

EXAMPLES
  tool-bridge list --config tools.yaml
  tool-bridge call weather --json '{"city":"Jakarta"}' --config tools.yaml
  tool-bridge serve --config tools.yaml
  tool-bridge presets
  tool-bridge preset github
`.trim());
}

function parseArgs(argv) {
  const args = { command: null, positional: [], flags: {} };
  let i = 0;
  
  while (i < argv.length) {
    const arg = argv[i];
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.flags[key] = next;
        i += 2;
      } else {
        args.flags[key] = true;
        i++;
      }
    } else if (!args.command) {
      args.command = arg;
      i++;
    } else {
      args.positional.push(arg);
      i++;
    }
  }
  
  return args;
}

function formatOutput(data, indent = 2) {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, indent);
}

function printTable(items, columns) {
  if (items.length === 0) {
    console.log('  (none)');
    return;
  }
  
  // Calculate column widths
  const widths = columns.map(col => {
    const headerLen = col.header.length;
    const maxData = Math.max(...items.map(item => String(item[col.key] || '').length));
    return Math.min(Math.max(headerLen, maxData), col.maxWidth || 50);
  });
  
  // Header
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(columns.map((_, i) => '─'.repeat(widths[i])).join('──'));
  
  // Rows
  for (const item of items) {
    const row = columns.map((col, i) => {
      const val = String(item[col.key] || '');
      return val.length > widths[i] ? val.substring(0, widths[i] - 1) + '…' : val.padEnd(widths[i]);
    }).join('  ');
    console.log(row);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.flags.config || null;
  
  const bridge = new ToolBridge({ config: configPath });
  
  // Load presets if specified
  if (args.flags.preset) {
    const preset = bridge.presets[args.flags.preset];
    if (!preset) {
      console.error(`Unknown preset: ${args.flags.preset}`);
      console.error(`Available: ${Object.keys(bridge.presets).join(', ')}`);
      process.exit(1);
    }
    bridge.config = preset;
  }
  
  // Load config file (merges/overrides preset)
  if (configPath) {
    await bridge.load(configPath);
  }
  
  switch (args.command) {
    case 'list':
    case 'ls': {
      const tools = bridge.list();
      if (tools.length === 0) {
        console.log('No tools configured. Use --config or --preset.');
        break;
      }
      console.log(`\n${tools.length} tool(s):\n`);
      printTable(tools, [
        { header: 'NAME', key: 'name', maxWidth: 25 },
        { header: 'TYPE', key: 'type', maxWidth: 6 },
        { header: 'METHOD', key: 'method', maxWidth: 8 },
        { header: 'DESCRIPTION', key: 'description', maxWidth: 50 },
        { header: 'AUTH', key: 'hasAuth', maxWidth: 5 },
      ]);
      console.log();
      break;
    }
    
    case 'call':
    case 'run': {
      const toolName = args.positional[0];
      if (!toolName) {
        console.error('Usage: tool-bridge call <tool> [--json \'{...}\']');
        process.exit(1);
      }
      
      let toolArgs = {};
      
      // Parse JSON args
      if (args.flags.json) {
        toolArgs = JSON.parse(args.flags.json);
      }
      
      // Parse positional key=value args
      for (const arg of args.positional.slice(1)) {
        const eq = arg.indexOf('=');
        if (eq > 0) {
          toolArgs[arg.substring(0, eq)] = arg.substring(eq + 1);
        }
      }
      
      const result = await bridge.call(toolName, toolArgs, {
        cache: !args.flags['no-cache'],
      });
      
      console.log(formatOutput(result));
      break;
    }
    
    case 'info': {
      const toolName = args.positional[0];
      if (!toolName) {
        console.error('Usage: tool-bridge info <tool>');
        process.exit(1);
      }
      
      try {
        const info = bridge.info(toolName);
        console.log(formatOutput(info));
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      break;
    }
    
    case 'validate': {
      const path = args.positional[0] || configPath;
      if (!path) {
        console.error('Usage: tool-bridge validate <config.yaml>');
        process.exit(1);
      }
      
      try {
        await bridge.load(path);
        const count = Object.keys(bridge.config.tools || {}).length;
        console.log(`✅ Valid: ${count} tool(s) configured`);
      } catch (err) {
        console.error(`❌ Invalid: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    
    case 'presets': {
      console.log('\nAvailable presets:\n');
      for (const [name, preset] of Object.entries(bridge.presets)) {
        const count = Object.keys(preset.tools || {}).length;
        console.log(`  ${name.padEnd(15)} ${count} tool(s)`);
      }
      console.log();
      break;
    }
    
    case 'preset': {
      const name = args.positional[0];
      if (!name) {
        console.error('Usage: tool-bridge preset <name>');
        process.exit(1);
      }
      
      const preset = bridge.presets[name];
      if (!preset) {
        console.error(`Unknown preset: ${name}`);
        console.error(`Available: ${Object.keys(bridge.presets).join(', ')}`);
        process.exit(1);
      }
      
      // Output as YAML-ish
      console.log(`# Preset: ${name}\n`);
      console.log(formatOutput(preset));
      break;
    }
    
    case 'serve': {
      // Spawn MCP server
      const { spawn } = await import('node:child_process');
      const serverArgs = [];
      if (configPath) serverArgs.push('--config', configPath);
      
      const child = spawn('node', [
        resolve(new URL('.', import.meta.url).pathname, 'mcp-server.mjs'),
        ...serverArgs,
      ], { stdio: 'inherit' });
      
      child.on('exit', (code) => process.exit(code || 0));
      break;
    }
    
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      usage();
      break;
    
    default:
      console.error(`Unknown command: ${args.command}`);
      usage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

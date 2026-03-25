#!/usr/bin/env node
/**
 * agent-visualize MCP Server — 10 tools via JSON-RPC stdio
 */

import { VisualizeEngine } from './index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const engine = new VisualizeEngine();

const TOOLS = {
  viz_bar: {
    description: 'Generate a bar chart SVG',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } } } },
        title: { type: 'string' },
        width: { type: 'number', default: 800 },
        height: { type: 'number', default: 500 },
        palette: { type: 'string', enum: ['default', 'vivid', 'pastel', 'dark', 'mono'] },
        horizontal: { type: 'boolean' },
        showValues: { type: 'boolean' },
        output: { type: 'string', description: 'File path to write SVG' },
      },
      required: ['data'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.bar(args.data, { title: args.title, horizontal: args.horizontal, showValues: args.showValues });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'bar', output: args.output || null };
    },
  },

  viz_line: {
    description: 'Generate a line chart SVG',
    inputSchema: {
      type: 'object',
      properties: {
        datasets: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, data: { type: 'array', items: { type: 'number' } }, color: { type: 'string' }, dashed: { type: 'boolean' } } } },
        labels: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        palette: { type: 'string' },
        area: { type: 'boolean' },
        dots: { type: 'boolean' },
        output: { type: 'string' },
      },
      required: ['datasets'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.line(args.datasets, { title: args.title, labels: args.labels, area: args.area, dots: args.dots });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'line' };
    },
  },

  viz_pie: {
    description: 'Generate a pie chart SVG',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } } } },
        title: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        palette: { type: 'string' },
        output: { type: 'string' },
      },
      required: ['data'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.pie(args.data, { title: args.title });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'pie' };
    },
  },

  viz_donut: {
    description: 'Generate a donut chart SVG',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } } } },
        title: { type: 'string' },
        centerLabel: { type: 'string' },
        centerValue: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        palette: { type: 'string' },
        output: { type: 'string' },
      },
      required: ['data'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.donut(args.data, { title: args.title, centerLabel: args.centerLabel, centerValue: args.centerValue });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'donut' };
    },
  },

  viz_scatter: {
    description: 'Generate a scatter plot SVG',
    inputSchema: {
      type: 'object',
      properties: {
        datasets: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, data: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } }, color: { type: 'string' } } } },
        title: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        palette: { type: 'string' },
        output: { type: 'string' },
      },
      required: ['datasets'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.scatter(args.datasets, { title: args.title });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'scatter' };
    },
  },

  viz_sparkline: {
    description: 'Generate a sparkline SVG',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { type: 'number' } },
        width: { type: 'number' }, height: { type: 'number' },
        color: { type: 'string' },
        dots: { type: 'boolean' },
        showLast: { type: 'boolean' },
        output: { type: 'string' },
      },
      required: ['data'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ palette: args.palette });
      const svg = eng.sparkline(args.data, { width: args.width, height: args.height, color: args.color, dots: args.dots, showLast: args.showLast });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'sparkline' };
    },
  },

  viz_heatmap: {
    description: 'Generate a heatmap SVG',
    inputSchema: {
      type: 'object',
      properties: {
        matrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        rowLabels: { type: 'array', items: { type: 'string' } },
        colLabels: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        output: { type: 'string' },
      },
      required: ['matrix'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height });
      const svg = eng.heatmap(args.matrix, { title: args.title, rowLabels: args.rowLabels, colLabels: args.colLabels });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'heatmap' };
    },
  },

  viz_gauge: {
    description: 'Generate a gauge meter SVG',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number' },
        title: { type: 'string' },
        min: { type: 'number' }, max: { type: 'number' },
        unit: { type: 'string' },
        label: { type: 'string' },
        width: { type: 'number' }, height: { type: 'number' },
        output: { type: 'string' },
      },
      required: ['value'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine();
      const svg = eng.gauge(args.value, { title: args.title, min: args.min, max: args.max, unit: args.unit, label: args.label, width: args.width, height: args.height });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'gauge' };
    },
  },

  viz_radar: {
    description: 'Generate a radar/spider chart SVG',
    inputSchema: {
      type: 'object',
      properties: {
        datasets: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, data: { type: 'array', items: { type: 'number' } }, color: { type: 'string' } } } },
        labels: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        dots: { type: 'boolean' },
        width: { type: 'number' }, height: { type: 'number' },
        palette: { type: 'string' },
        output: { type: 'string' },
      },
      required: ['datasets'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, height: args.height, palette: args.palette });
      const svg = eng.radar(args.datasets, { title: args.title, labels: args.labels, dots: args.dots });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'radar' };
    },
  },

  viz_kpi: {
    description: 'Generate KPI dashboard cards SVG',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' }, change: { type: 'number' }, color: { type: 'string' } } } },
        title: { type: 'string' },
        width: { type: 'number' },
        palette: { type: 'string' },
        output: { type: 'string' },
      },
      required: ['items'],
    },
    handler: (args) => {
      const eng = new VisualizeEngine({ width: args.width, palette: args.palette });
      const svg = eng.kpi(args.items, { title: args.title });
      if (args.output) writeFileSync(args.output, svg);
      return { svg, chartType: 'kpi' };
    },
  },
};

// ─── JSON-RPC Server ───────────────────────────────────────────────────────

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleRequest(line);
  }
});

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id };
  if (error) resp.error = { code: -32000, message: error };
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

function handleRequest(raw) {
  let msg;
  try { msg = JSON.parse(raw); }
  catch { return respond(null, null, 'Parse error'); }

  if (msg.method === 'initialize') {
    return respond(msg.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'agent-visualize', version: '1.0.0' },
      capabilities: { tools: {} },
    });
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'ping') return respond(msg.id, {});

  if (msg.method === 'tools/list') {
    return respond(msg.id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (msg.method === 'tools/call') {
    const tool = TOOLS[msg.params?.name];
    if (!tool) return respond(msg.id, null, `Unknown tool: ${msg.params?.name}`);
    try {
      const result = tool.handler(msg.params?.arguments || {});
      return respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond(msg.id, null, e.message);
    }
  }

  respond(msg.id, null, `Unknown method: ${msg.method}`);
}

process.stderr.write('agent-visualize MCP server ready (10 tools)\n');

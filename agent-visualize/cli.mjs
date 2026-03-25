#!/usr/bin/env node
/**
 * agent-visualize CLI — generate SVG charts from command line
 */

import { VisualizeEngine, PALETTES } from './index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const USAGE = `
agent-visualize — SVG charting from the command line

USAGE
  agent-visualize <command> [options]

COMMANDS
  bar <data>              Bar chart (JSON: [{label,value}])
  line <data>             Line chart (JSON: [{label,data:[y...]}])
  pie <data>              Pie chart (JSON: [{label,value}])
  donut <data>            Donut chart
  scatter <data>          Scatter plot (JSON: [{label,data:[{x,y}]}])
  sparkline <data>        Sparkline (JSON: [y...])
  heatmap <data>          Heatmap (JSON: [[v...],[v...]])
  gauge <value>           Gauge meter
  radar <data>            Radar/spider chart
  table <data>            Data table
  kpi <data>              KPI dashboard cards
  demo                    Generate demo charts
  serve                   Start HTTP server (port 3140)
  mcp                     Start MCP server (stdio)

OPTIONS
  --title <str>           Chart title
  --width <n>             Width in pixels (default: 800)
  --height <n>            Height in pixels (default: 500)
  --palette <name>        Color palette: default|vivid|pastel|dark|mono
  --output <file>         Write SVG to file (default: stdout)
  --min <n>               Gauge minimum
  --max <n>               Gauge maximum
  --unit <str>            Gauge unit label
  --labels <csv>          Comma-separated axis/row labels
  --donut                 Pie → donut
  --horizontal            Horizontal bar chart
  --area                  Area fill on line chart
  --dots                  Show data points
  --show-values           Show values on bars
  --precision <n>         Decimal precision
  --bg <color>            Background color

EXAMPLES
  agent-visualize bar '[{"label":"Q1","value":42},{"label":"Q2","value":58}]' --title Revenue
  agent-visualize line '[{"label":"CPU","data":[45,52,48,61,55]}]' --dots --area
  agent-visualize gauge 75 --title "CPU" --unit "%" --min 0 --max 100
  agent-visualize sparkline '[1,5,3,8,2,7]' --output spark.svg
  agent-visualize demo
`.trim();

function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (['donut', 'horizontal', 'area', 'dots', 'show-values'].includes(key)) {
        opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      } else {
        opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { opts, positional };
}

function parseData(str) {
  try { return JSON.parse(str); }
  catch { console.error(`Invalid JSON: ${str}`); process.exit(1); }
}

function output(svg, opts) {
  if (opts.output) {
    writeFileSync(opts.output, svg);
    console.error(`Written to ${opts.output}`);
  } else {
    process.stdout.write(svg);
  }
}

// ─── Commands ──────────────────────────────────────────────────────────────

const commands = {
  bar(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, height: +opts.height || 500, palette: opts.palette });
    const items = Array.isArray(data) ? data : (data.labels || []).map((l, i) => ({ label: l, value: (data.values || [])[i] }));
    return eng.bar(items, {
      title: opts.title,
      horizontal: opts.horizontal,
      showValues: opts.showValues,
      precision: opts.precision != null ? +opts.precision : undefined,
    });
  },
  line(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, height: +opts.height || 500, palette: opts.palette });
    return eng.line(Array.isArray(data) ? data : [data], {
      title: opts.title,
      labels: opts.labels ? opts.labels.split(',') : undefined,
      area: opts.area,
      dots: opts.dots,
      precision: opts.precision != null ? +opts.precision : undefined,
    });
  },
  pie(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 500, height: +opts.height || 500, palette: opts.palette });
    const items = Array.isArray(data) ? data : (data.labels || []).map((l, i) => ({ label: l, value: (data.values || [])[i] }));
    return eng.pie(items, { title: opts.title, labels: opts.labels !== 'false' });
  },
  donut(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 500, height: +opts.height || 500, palette: opts.palette });
    const items = Array.isArray(data) ? data : (data.labels || []).map((l, i) => ({ label: l, value: (data.values || [])[i] }));
    return eng.donut(items, { title: opts.title });
  },
  scatter(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, height: +opts.height || 500, palette: opts.palette });
    return eng.scatter(Array.isArray(data) ? data : [data], { title: opts.title, dots: opts.dots });
  },
  sparkline(data, opts) {
    const eng = new VisualizeEngine({ palette: opts.palette });
    return eng.sparkline(Array.isArray(data) ? data : [data], {
      width: +opts.width || 200,
      height: +opts.height || 50,
      color: opts.color,
      dots: opts.dots,
      area: opts.area !== false,
    });
  },
  heatmap(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, height: +opts.height || 500, palette: opts.palette });
    return eng.heatmap(data, {
      title: opts.title,
      rowLabels: opts.rowLabels ? opts.rowLabels.split(',') : undefined,
      colLabels: opts.colLabels ? opts.colLabels.split(',') : undefined,
    });
  },
  gauge(data, opts) {
    const eng = new VisualizeEngine({ palette: opts.palette });
    return eng.gauge(+data, {
      title: opts.title,
      min: opts.min != null ? +opts.min : undefined,
      max: opts.max != null ? +opts.max : undefined,
      unit: opts.unit,
      label: opts.label,
      width: +opts.width || 300,
      height: +opts.height || 200,
    });
  },
  radar(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 600, height: +opts.height || 600, palette: opts.palette });
    return eng.radar(Array.isArray(data) ? data : [data], {
      title: opts.title,
      labels: opts.labels ? opts.labels.split(',') : undefined,
      dots: opts.dots,
    });
  },
  table(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, palette: opts.palette });
    if (!data.columns || !data.rows) {
      console.error('Table requires { columns: [{key,label}], rows: [...] }');
      process.exit(1);
    }
    return eng.table(data.columns, data.rows, { title: opts.title });
  },
  kpi(data, opts) {
    const eng = new VisualizeEngine({ width: +opts.width || 800, palette: opts.palette });
    return eng.kpi(Array.isArray(data) ? data : [data], { title: opts.title });
  },
};

function demo() {
  const eng = new VisualizeEngine({ width: 800, height: 500, palette: 'vivid' });
  const dir = process.cwd();

  writeFileSync(`${dir}/demo-bar.svg`, eng.bar([
    { label: 'Q1', value: 42 }, { label: 'Q2', value: 58 },
    { label: 'Q3', value: 71 }, { label: 'Q4', value: 63 },
  ], { title: 'Quarterly Revenue ($K)', showValues: true }));

  writeFileSync(`${dir}/demo-line.svg`, eng.line([
    { label: 'Users', data: [100, 150, 200, 180, 250, 310, 280] },
    { label: 'Sessions', data: [200, 280, 350, 300, 420, 500, 450] },
  ], { title: 'Growth Metrics', dots: true, area: true, labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }));

  writeFileSync(`${dir}/demo-pie.svg`, eng.pie([
    { label: 'Chrome', value: 65 }, { label: 'Firefox', value: 15 },
    { label: 'Safari', value: 12 }, { label: 'Edge', value: 8 },
  ], { title: 'Browser Share' }));

  writeFileSync(`${dir}/demo-donut.svg`, eng.donut([
    { label: 'API', value: 40 }, { label: 'Web', value: 35 },
    { label: 'Mobile', value: 25 },
  ], { title: 'Traffic Sources', centerLabel: 'Total', centerValue: '100%' }));

  writeFileSync(`${dir}/demo-sparkline.svg`, eng.sparkline(
    [12, 15, 13, 18, 22, 19, 25, 28, 24, 30, 27, 32],
    { width: 300, height: 60, color: '#27ae60', showLast: true }
  ));

  writeFileSync(`${dir}/demo-gauge.svg`, eng.gauge(73, { title: 'CPU Usage', unit: '%', label: 'System Load' }));

  writeFileSync(`${dir}/demo-heatmap.svg`, eng.heatmap(
    Array.from({ length: 7 }, (_, r) => Array.from({ length: 12 }, () => Math.round(Math.random() * 100))),
    { title: 'Activity Heatmap', rowLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      colLabels: ['8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm'] }
  ));

  writeFileSync(`${dir}/demo-radar.svg`, eng.radar([
    { label: 'Current', data: [80, 90, 60, 70, 85, 75] },
    { label: 'Target', data: [90, 85, 80, 85, 90, 90] },
  ], { title: 'Performance', labels: ['Speed', 'Accuracy', 'Coverage', 'Latency', 'Throughput', 'Reliability'], dots: true }));

  writeFileSync(`${dir}/demo-kpi.svg`, eng.kpi([
    { label: 'Revenue', value: '$42.5K', change: 12.3, color: '#27ae60' },
    { label: 'Users', value: '8,432', change: 5.7, color: '#3498db' },
    { label: 'Uptime', value: '99.9%', change: 0.1, color: '#27ae60' },
    { label: 'Errors', value: '23', change: -18.2, color: '#e74c3c' },
  ], { title: 'System Overview' }));

  writeFileSync(`${dir}/demo-table.svg`, eng.table(
    [{ key: 'name', label: 'Name' }, { key: 'score', label: 'Score', align: 'right' }, { key: 'grade', label: 'Grade', align: 'center' }],
    [
      { name: 'Alice', score: 95, grade: 'A' },
      { name: 'Bob', score: 87, grade: 'B+' },
      { name: 'Carol', score: 92, grade: 'A-' },
      { name: 'Dave', score: 78, grade: 'B' },
    ],
    { title: 'Leaderboard' }
  ));

  console.error('Generated 10 demo charts: demo-*.svg');
}

// ─── Main ──────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

if (cmd === 'demo') { demo(); process.exit(0); }
if (cmd === 'serve') {
  await import('./server.mjs');
  process.exit(0);
}
if (cmd === 'mcp') {
  await import('./mcp-server.mjs');
  process.exit(0);
}

const { opts, positional } = parseArgs(rest);
if (commands[cmd]) {
  const data = positional[0] ? parseData(positional[0]) : [];
  const svg = commands[cmd](data, opts);
  output(svg, opts);
} else {
  console.error(`Unknown command: ${cmd}\nRun agent-visualize --help`);
  process.exit(1);
}

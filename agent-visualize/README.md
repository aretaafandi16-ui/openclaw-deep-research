# agent-visualize

Zero-dependency SVG charting & visualization engine for AI agents. Pure SVG output — no canvas, no deps, no native modules.

## Features

- **12 chart types**: bar, line, pie, donut, scatter, sparkline, heatmap, gauge, radar, stacked area, KPI cards, data table
- **Pure SVG**: every chart returns a complete `<svg>` string — embed anywhere
- **Zero dependencies**: nothing to install, works in any Node.js environment
- **5 color palettes**: default, vivid, pastel, dark, mono
- **Full API**: HTTP server with REST API + interactive web dashboard
- **MCP server**: 10 tools for AI agent integration via Model Context Protocol
- **CLI**: generate charts from the command line, export to files
- **EventEmitter**: hook into chart generation events
- **Composable**: build dashboards by combining charts

## Quick Start

```js
import { VisualizeEngine } from './index.mjs';

const viz = new VisualizeEngine({ palette: 'vivid' });

// Bar chart
const barSvg = viz.bar([
  { label: 'Q1', value: 42 },
  { label: 'Q2', value: 58 },
  { label: 'Q3', value: 71 },
], { title: 'Revenue ($K)', showValues: true });

// Line chart
const lineSvg = viz.line([
  { label: 'Users', data: [100, 150, 200, 250, 310] },
  { label: 'Sessions', data: [200, 280, 350, 420, 500] },
], { title: 'Growth', dots: true, area: true, labels: ['Mon','Tue','Wed','Thu','Fri'] });

// Save to file
import { writeFileSync } from 'node:fs';
writeFileSync('chart.svg', barSvg);
```

## Chart Types

### Bar Chart
```js
// Basic
viz.bar([{ label: 'A', value: 30 }, { label: 'B', value: 50 }], { title: 'Sales' });

// Horizontal
viz.bar(data, { horizontal: true });

// With values shown
viz.bar(data, { showValues: true });

// Grouped (multi-series)
viz.barGrouped([
  { label: '2024', data: [10, 20, 30] },
  { label: '2025', data: [15, 25, 35] },
], { labels: ['Q1', 'Q2', 'Q3'] });
```

### Line Chart
```js
// Single series
viz.line([{ label: 'CPU', data: [45, 52, 48, 61, 55] }], { dots: true });

// Multi-series with area fill
viz.line([
  { label: 'API', data: [100, 150, 200], color: '#4e79a7' },
  { label: 'Web', data: [80, 120, 180], color: '#e15759', dashed: true },
], { area: true, labels: ['Jan', 'Feb', 'Mar'] });
```

### Pie / Donut
```js
viz.pie([{ label: 'Chrome', value: 65 }, { label: 'Firefox', value: 35 }]);

viz.donut(data, {
  centerLabel: 'Total',
  centerValue: '100%',
  donutRatio: 0.6,
});
```

### Scatter Plot
```js
viz.scatter([
  { label: 'Group A', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  { label: 'Group B', data: [{ x: 5, y: 1 }, { x: 2, y: 5 }] },
], { pointRadius: 6 });
```

### Sparkline
```js
viz.sparkline([12, 15, 13, 18, 22, 19, 25], {
  width: 200, height: 50,
  color: '#27ae60',
  showLast: true,
});
```

### Heatmap
```js
viz.heatmap([
  [30, 45, 60],
  [20, 55, 70],
  [40, 35, 50],
], {
  rowLabels: ['Mon', 'Tue', 'Wed'],
  colLabels: ['Morning', 'Afternoon', 'Evening'],
  colorStart: '#e8f4f8',
  colorEnd: '#1a5276',
});
```

### Gauge
```js
viz.gauge(75, {
  title: 'CPU Usage',
  unit: '%',
  label: 'System Load',
  min: 0,
  max: 100,
});
```

### Radar Chart
```js
viz.radar([
  { label: 'Current', data: [80, 90, 60, 70, 85] },
  { label: 'Target', data: [90, 85, 80, 85, 90] },
], {
  labels: ['Speed', 'Power', 'Defense', 'Agility', 'Stamina'],
  dots: true,
});
```

### Stacked Area
```js
viz.areaStacked([
  { label: 'API', data: [10, 20, 15] },
  { label: 'Web', data: [5, 10, 8] },
], { title: 'Traffic', labels: ['Mon', 'Tue', 'Wed'] });
```

### KPI Cards
```js
viz.kpi([
  { label: 'Revenue', value: '$42.5K', change: 12.3, color: '#27ae60' },
  { label: 'Users', value: '8,432', change: -3.2, color: '#3498db' },
], { title: 'Dashboard' });
```

### Data Table
```js
viz.table(
  [{ key: 'name', label: 'Name' }, { key: 'score', label: 'Score', align: 'right' }],
  [{ name: 'Alice', score: 95 }, { name: 'Bob', score: 87 }],
  { title: 'Leaderboard' }
);
```

## Color Palettes

```js
import { PALETTES } from './index.mjs';

// Available: default, vivid, pastel, dark, mono (10 colors each)
const viz = new VisualizeEngine({ palette: 'vivid' });
```

## HTTP Server

```bash
node server.mjs  # Starts on port 3140
```

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bar` | POST | Generate bar chart |
| `/api/line` | POST | Generate line chart |
| `/api/pie` | POST | Generate pie chart |
| `/api/donut` | POST | Generate donut chart |
| `/api/scatter` | POST | Generate scatter plot |
| `/api/sparkline` | POST | Generate sparkline |
| `/api/heatmap` | POST | Generate heatmap |
| `/api/gauge` | POST | Generate gauge |
| `/api/radar` | POST | Generate radar chart |
| `/api/kpi` | POST | Generate KPI cards |
| `/api/table` | POST | Generate data table |
| `/api/area` | POST | Generate stacked area chart |
| `/api/types` | GET | List chart types |
| `/api/palettes` | GET | List palettes |
| `/api/stats` | GET | Server stats |
| `/` | GET | Web dashboard |

### Example API Call

```bash
curl -X POST http://localhost:3140/api/bar \
  -H 'Content-Type: application/json' \
  -d '{"data":[{"label":"A","value":30},{"label":"B","value":50}],"title":"Sales","palette":"vivid"}'
```

## MCP Server

```bash
node mcp-server.mjs  # JSON-RPC stdio
```

### Tools (10)

| Tool | Description |
|------|-------------|
| `viz_bar` | Generate bar chart |
| `viz_line` | Generate line chart |
| `viz_pie` | Generate pie chart |
| `viz_donut` | Generate donut chart |
| `viz_scatter` | Generate scatter plot |
| `viz_sparkline` | Generate sparkline |
| `viz_heatmap` | Generate heatmap |
| `viz_gauge` | Generate gauge meter |
| `viz_radar` | Generate radar chart |
| `viz_kpi` | Generate KPI cards |

All tools accept an `output` parameter to write SVG directly to a file.

## CLI

```bash
# Bar chart
node cli.mjs bar '[{"label":"Q1","value":42},{"label":"Q2","value":58}]' --title Revenue

# Line chart
node cli.mjs line '[{"label":"CPU","data":[45,52,48,61,55]}]' --dots --area

# Pie chart
node cli.mjs pie '[{"label":"A",value":60},{"label":"B","value":40}]' --palette vivid

# Gauge
node cli.mjs gauge 75 --title "CPU" --unit "%" --min 0 --max 100

# Sparkline to file
node cli.mjs sparkline '[1,5,3,8,2,7]' --output spark.svg --color '#27ae60'

# Generate demo charts
node cli.mjs demo

# Start server
node cli.mjs serve

# Start MCP
node cli.mjs mcp
```

## API Reference

### `new VisualizeEngine(opts?)`

Options:
- `width` (800) — default chart width
- `height` (500) — default chart height
- `palette` ('default') — color palette name
- `bg` ('#ffffff') — background color
- `fontFamily` ('system-ui...') — text font
- `fontSize` (12) — base font size
- `titleSize` (18) — title font size
- `margin` ({ top:50, right:30, bottom:50, left:60 }) — chart margins

### Methods

All methods return an SVG string:
- `.bar(data, opts?)` — bar chart
- `.barGrouped(datasets, opts?)` — grouped bar chart
- `.line(datasets, opts?)` — line chart
- `.pie(data, opts?)` — pie chart
- `.donut(data, opts?)` — donut chart
- `.scatter(datasets, opts?)` — scatter plot
- `.sparkline(data, opts?)` — sparkline
- `.heatmap(matrix, opts?)` — heatmap
- `.gauge(value, opts?)` — gauge meter
- `.radar(datasets, opts?)` — radar chart
- `.areaStacked(datasets, opts?)` — stacked area chart
- `.kpi(items, opts?)` — KPI cards
- `.table(columns, rows, opts?)` — data table
- `.dashboard(charts, opts?)` — composite dashboard

### Registry

- `.get(id)` — get chart by ID
- `.list()` — list all generated charts
- `.clear()` — clear registry

### Events

- `chart` — emitted when a chart is generated `{ id, type }`

## Testing

```bash
node test.mjs  # 66 tests
```

## License

MIT

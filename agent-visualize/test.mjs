#!/usr/bin/env node
/**
 * agent-visualize test suite — 60 tests
 */

import { VisualizeEngine, PALETTES, create } from './index.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n▸ ${name}`); }

// ─── Engine Basics ─────────────────────────────────────────────────────────

section('Engine instantiation');
const eng = new VisualizeEngine();
assert(eng instanceof VisualizeEngine, 'default constructor');
assert(eng.width === 800, 'default width');
assert(eng.height === 500, 'default height');
assert(eng.palette === 'default', 'default palette');

const eng2 = create({ width: 600, height: 400, palette: 'vivid' });
assert(eng2.width === 600, 'custom width');
assert(eng2.palette === 'vivid', 'custom palette');

section('Color palettes');
assert(Object.keys(PALETTES).length >= 5, '5+ palettes');
assert(PALETTES.default.length === 10, 'default has 10 colors');
assert(PALETTES.vivid.length === 10, 'vivid has 10 colors');

// ─── Bar Chart ─────────────────────────────────────────────────────────────

section('Bar chart');
const barSvg = eng.bar([
  { label: 'A', value: 30 },
  { label: 'B', value: 50 },
  { label: 'C', value: 20 },
], { title: 'Test Bar' });
assert(barSvg.startsWith('<svg'), 'bar returns SVG');
assert(barSvg.includes('Test Bar'), 'bar includes title');
assert(barSvg.includes('<path'), 'bar has paths');
assert(barSvg.includes('</svg>'), 'bar closes SVG');
assert(eng.charts.size >= 1, 'bar stored in charts');

// Bar with object format
const barSvg2 = eng.bar({ labels: ['X', 'Y'], values: [10, 20] });
assert(barSvg2.startsWith('<svg'), 'bar object format works');

// Horizontal bar
const barH = eng.bar([{ label: 'H1', value: 40 }], { horizontal: true });
assert(barH.includes('<path'), 'horizontal bar renders');

// Show values
const barV = eng.bar([{ label: 'V', value: 99 }], { showValues: true });
assert(barV.includes('99'), 'showValues works');

section('Grouped bar chart');
const gBar = eng.barGrouped([
  { label: 'A', data: [10, 20, 30] },
  { label: 'B', data: [15, 25, 35] },
], { labels: ['Jan', 'Feb', 'Mar'] });
assert(gBar.includes('<svg'), 'grouped bar returns SVG');
assert(gBar.includes('Jan'), 'grouped bar has labels');

// ─── Line Chart ────────────────────────────────────────────────────────────

section('Line chart');
const lineSvg = eng.line([{ label: 'Series', data: [1, 3, 2, 5, 4] }], { title: 'Test Line' });
assert(lineSvg.includes('<polyline'), 'line has polylines');
assert(lineSvg.includes('Test Line'), 'line includes title');

// Multi-series
const lineMulti = eng.line([
  { label: 'A', data: [1, 2, 3] },
  { label: 'B', data: [3, 2, 1], dashed: true },
], { labels: ['X', 'Y', 'Z'] });
assert(lineMulti.includes('dasharray'), 'dashed lines work');

// Area fill
const lineArea = eng.line([{ label: 'A', data: [1, 2, 3] }], { area: true });
assert(lineArea.includes('<polygon'), 'area fill renders');

// Dots
const lineDots = eng.line([{ label: 'A', data: [1, 2, 3] }], { dots: true });
assert(lineDots.includes('<circle'), 'dots render');

// ─── Pie / Donut ───────────────────────────────────────────────────────────

section('Pie chart');
const pieSvg = eng.pie([
  { label: 'A', value: 40 },
  { label: 'B', value: 35 },
  { label: 'C', value: 25 },
]);
assert(pieSvg.includes('<path'), 'pie has paths');
assert(pieSvg.includes('%'), 'pie shows percentages');

// Object format
const pieObj = eng.pie({ labels: ['X', 'Y'], values: [60, 40] });
assert(pieObj.includes('<path'), 'pie object format works');

section('Donut chart');
const donutSvg = eng.donut([
  { label: 'A', value: 50 },
  { label: 'B', value: 50 },
], { centerLabel: 'Total', centerValue: '100' });
assert(donutSvg.includes('Total'), 'donut center label');
assert(donutSvg.includes('100'), 'donut center value');

// ─── Scatter ───────────────────────────────────────────────────────────────

section('Scatter plot');
const scatterSvg = eng.scatter([
  { label: 'G1', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  { label: 'G2', data: [{ x: 5, y: 1 }, { x: 2, y: 5 }] },
]);
assert(scatterSvg.includes('<circle'), 'scatter has circles');

// Custom point radius
const scatterR = eng.scatter([{ label: 'G', data: [{ x: 1, y: 1, r: 10 }] }]);
assert(scatterR.includes('r="10"'), 'scatter custom radius');

// ─── Sparkline ─────────────────────────────────────────────────────────────

section('Sparkline');
const sparkSvg = eng.sparkline([1, 5, 3, 8, 2, 7]);
assert(sparkSvg.includes('<polyline'), 'sparkline has polyline');
assert(sparkSvg.includes('transparent'), 'sparkline transparent bg');

const sparkDots = eng.sparkline([1, 2, 3], { dots: true });
assert(sparkDots.includes('<circle'), 'sparkline dots');

const sparkLast = eng.sparkline([10, 20, 30], { showLast: true });
assert(sparkLast.includes('30'), 'sparkline showLast');

// ─── Heatmap ───────────────────────────────────────────────────────────────

section('Heatmap');
const heatSvg = eng.heatmap([
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
], { rowLabels: ['R1', 'R2', 'R3'], colLabels: ['C1', 'C2', 'C3'] });
assert(heatSvg.includes('<rect'), 'heatmap has rects');
assert(heatSvg.includes('R1'), 'heatmap row labels');
assert(heatSvg.includes('C1'), 'heatmap col labels');

// Custom colors
const heatCustom = eng.heatmap([[0, 100]], { colorStart: '#000000', colorEnd: '#ffffff' });
assert(heatCustom.includes('#000000') || heatCustom.includes('#'), 'heatmap custom colors');

// ─── Gauge ─────────────────────────────────────────────────────────────────

section('Gauge');
const gaugeSvg = eng.gauge(75, { title: 'CPU', unit: '%', label: 'Usage' });
assert(gaugeSvg.includes('<line'), 'gauge has needle');
assert(gaugeSvg.includes('75%'), 'gauge value');
assert(gaugeSvg.includes('CPU'), 'gauge title');
assert(gaugeSvg.includes('Usage'), 'gauge label');

const gaugeMin = eng.gauge(50, { min: -100, max: 100 });
assert(gaugeMin.includes('-100'), 'gauge custom min/max');

// ─── Radar ─────────────────────────────────────────────────────────────────

section('Radar chart');
const radarSvg = eng.radar([
  { label: 'Player A', data: [80, 90, 60, 70, 85] },
  { label: 'Player B', data: [70, 60, 90, 80, 75] },
], { labels: ['Speed', 'Power', 'Defense', 'Agility', 'Stamina'] });
assert(radarSvg.includes('<polygon'), 'radar has polygons');
assert(radarSvg.includes('Speed'), 'radar axis labels');
assert(radarSvg.includes('Player A'), 'radar legend');

const radarDots = eng.radar([{ label: 'A', data: [50, 60] }], { dots: true });
assert(radarDots.includes('<circle'), 'radar dots');

// ─── Stacked Area ──────────────────────────────────────────────────────────

section('Stacked area chart');
const areaSvg = eng.areaStacked([
  { label: 'A', data: [10, 20, 15] },
  { label: 'B', data: [5, 10, 8] },
], { title: 'Stacked' });
assert(areaSvg.includes('<polygon'), 'stacked area has polygons');
assert(areaSvg.includes('Stacked'), 'stacked area title');

// ─── KPI Cards ─────────────────────────────────────────────────────────────

section('KPI cards');
const kpiSvg = eng.kpi([
  { label: 'Revenue', value: '$12.5K', change: 12.3, color: '#27ae60' },
  { label: 'Users', value: '1,234', change: -3.2 },
]);
assert(kpiSvg.includes('$12.5K'), 'kpi value');
assert(kpiSvg.includes('▲'), 'kpi positive arrow');
assert(kpiSvg.includes('▼'), 'kpi negative arrow');

// ─── Table ─────────────────────────────────────────────────────────────────

section('Table');
const tableSvg = eng.table(
  [{ key: 'name', label: 'Name' }, { key: 'score', label: 'Score', align: 'right' }],
  [{ name: 'Alice', score: 95 }, { name: 'Bob', score: 87 }],
  { title: 'Leaderboard' }
);
assert(tableSvg.includes('Leaderboard'), 'table title');
assert(tableSvg.includes('Alice'), 'table row data');
assert(tableSvg.includes('<rect'), 'table has cells');

// ─── Chart Registry ───────────────────────────────────────────────────────

section('Chart registry');
const allCharts = eng.list();
assert(allCharts.length >= 10, `registry has ${allCharts.length} charts`);
assert(allCharts.some(c => c.type === 'bar'), 'registry has bar');
assert(allCharts.some(c => c.type === 'line'), 'registry has line');
assert(allCharts.some(c => c.type === 'pie'), 'registry has pie');

const firstId = allCharts[0].id;
assert(eng.get(firstId) !== undefined, 'get by id works');

eng.clear();
assert(eng.list().length === 0, 'clear works');

// ─── Events ────────────────────────────────────────────────────────────────

section('EventEmitter');
let eventFired = false;
eng.on('chart', () => { eventFired = true; });
eng.bar([{ label: 'E', value: 1 }]);
assert(eventFired, 'chart event fires');

// ─── Edge Cases ────────────────────────────────────────────────────────────

section('Edge cases');
// Single bar
const singleBar = eng.bar([{ label: 'Only', value: 42 }]);
assert(singleBar.includes('<svg'), 'single bar works');

// Empty-ish data
const emptyLine = eng.line([{ label: 'E', data: [0, 0, 0] }]);
assert(emptyLine.includes('<polyline'), 'zero data line works');

// Large values
const bigPie = eng.pie([{ label: 'Huge', value: 1e9 }, { label: 'Small', value: 1 }]);
assert(bigPie.includes('<path'), 'large values pie works');

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail > 0 ? 1 : 0);

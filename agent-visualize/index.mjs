/**
 * agent-visualize — Zero-dep SVG charting & visualization engine for AI agents
 * 
 * Supports: bar, line, pie, donut, scatter, sparkline, heatmap, gauge, treemap, radar
 * All output is pure SVG strings — no canvas, no deps.
 */

import { EventEmitter } from 'node:events';

// ─── Color Palettes ───────────────────────────────────────────────────────

const PALETTES = {
  default: ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'],
  vivid:   ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45','#fabebe'],
  pastel:  ['#aec7e8','#ffbb78','#98df8a','#ff9896','#c5b0d5','#c49c94','#f7b6d2','#dbdb8d','#9edae5','#c7c7c7'],
  dark:    ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'],
  mono:    ['#2c3e50','#34495e','#7f8c8d','#95a5a6','#bdc3c7','#ecf0f1','#d5dbdb','#aab7b8','#839192','#717d7e'],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function minMax(arr) { let mn=Infinity, mx=-Infinity; for (const v of arr) { if (v<mn) mn=v; if (v>mx) mx=v; } return [mn, mx]; }
function lerp(a,b,t) { return a+(b-a)*t; }
function roundRect(x,y,w,h,r) {
  r = Math.min(r, w/2, h/2);
  return `M${x+r},${y} L${x+w-r},${y} Q${x+w},${y} ${x+w},${y+r} L${x+w},${y+h-r} Q${x+w},${y+h} ${x+w-r},${y+h} L${x+r},${y+h} Q${x},${y+h} ${x},${y+h-r} L${x},${y+r} Q${x},${y} ${x+r},${y} Z`;
}
function getColor(palette, i) {
  const p = PALETTES[palette] || PALETTES.default;
  return p[i % p.length];
}
function svgWrap(width, height, inner, bg = '#ffffff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bg}"/>${inner}</svg>`;
}

// ─── Chart Engine ──────────────────────────────────────────────────────────

export class VisualizeEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.width = opts.width || 800;
    this.height = opts.height || 500;
    this.palette = opts.palette || 'default';
    this.bg = opts.bg || '#ffffff';
    this.fontFamily = opts.fontFamily || 'system-ui, -apple-system, sans-serif';
    this.fontSize = opts.fontSize || 12;
    this.titleSize = opts.titleSize || 18;
    this.margin = opts.margin || { top: 50, right: 30, bottom: 50, left: 60 };
    this.charts = new Map();
    this._counter = 0;
  }

  _id() { return `chart_${++this._counter}_${Date.now()}`; }
  _title(title, w) {
    if (!title) return '';
    const x = w / 2;
    return `<text x="${x}" y="30" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.titleSize}" font-weight="600" fill="#333">${esc(title)}</text>`;
  }
  _axisLabel(text, x, y, anchor, rotate = 0) {
    const tf = rotate ? ` transform="rotate(${rotate},${x},${y})"` : '';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#666"${tf}>${esc(text)}</text>`;
  }
  _tickLabel(text, x, y, anchor = 'middle') {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${this.fontFamily}" font-size="${this.fontSize - 1}" fill="#888">${esc(text)}</text>`;
  }
  _gridLine(x1, y1, x2, y2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#eee" stroke-width="1"/>`;
  }

  // ── Bar Chart ───────────────────────────────────────────────────────

  bar(data, opts = {}) {
    // data: [{ label, value, color? }] or { labels: [], values: [] }
    const items = Array.isArray(data) ? data : data.labels.map((l, i) => ({ label: l, value: data.values[i] }));
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;
    const title = opts.title;
    const group = opts.grouped || opts.stacked;
    const horizontal = opts.horizontal;

    let inner = this._title(title, w);
    const [, maxVal] = minMax(items.map(d => d.value));
    const yMax = maxVal * 1.1;
    const barW = cw / items.length * 0.7;
    const gap = cw / items.length * 0.3;

    // Y axis
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = m.top + ch - (ch * i / yTicks);
      const val = (yMax * i / yTicks).toFixed(opts.precision ?? 0);
      inner += this._gridLine(m.left, y, w - m.right, y);
      inner += this._tickLabel(val, m.left - 8, y + 4, 'end');
    }

    // Bars
    items.forEach((d, i) => {
      const x = m.left + (i * (cw / items.length)) + gap / 2;
      const barH = (d.value / yMax) * ch;
      const y = m.top + ch - barH;
      const color = d.color || getColor(this.palette, i);
      const radius = Math.min(4, barW / 2);

      if (horizontal) {
        const hx = m.left;
        const hy = m.top + (i * (ch / items.length)) + gap / 2;
        const hw = (d.value / yMax) * cw;
        const hh = ch / items.length - gap;
        inner += `<path d="${roundRect(hx, hy, hw, hh, radius)}" fill="${color}" opacity="0.9"/>`;
        inner += this._tickLabel(d.label, hx - 8, hy + hh / 2 + 4, 'end');
        inner += this._tickLabel(String(d.value), hx + hw + 8, hy + hh / 2 + 4, 'start');
      } else {
        inner += `<path d="${roundRect(x, y, barW, barH, radius)}" fill="${color}" opacity="0.9"/>`;
        inner += this._tickLabel(d.label, x + barW / 2, m.top + ch + 18);
        if (opts.showValues) {
          inner += this._tickLabel(String(d.value), x + barW / 2, y - 6);
        }
      }
    });

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'bar', svg, data: items });
    this.emit('chart', { id, type: 'bar' });
    return svg;
  }

  // ── Grouped Bar Chart ──────────────────────────────────────────────

  barGrouped(datasets, opts = {}) {
    // datasets: [{ label: 'Series A', data: [1,2,3] }, ...], opts.labels: ['Jan','Feb','Mar']
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;
    const labels = opts.labels || datasets[0].data.map((_, i) => String(i));

    let inner = this._title(opts.title, w);
    const allVals = datasets.flatMap(d => d.data);
    const [, yMax] = minMax(allVals);

    // Y axis
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = m.top + ch - (ch * i / yTicks);
      const val = (yMax * 1.1 * i / yTicks).toFixed(0);
      inner += this._gridLine(m.left, y, w - m.right, y);
      inner += this._tickLabel(val, m.left - 8, y + 4, 'end');
    }

    const groupW = cw / labels.length;
    const barW = (groupW * 0.8) / datasets.length;
    const groupPad = groupW * 0.1;

    labels.forEach((label, li) => {
      const gx = m.left + li * groupW + groupPad;
      datasets.forEach((ds, di) => {
        const x = gx + di * barW;
        const barH = (ds.data[li] / (yMax * 1.1)) * ch;
        const y = m.top + ch - barH;
        const color = ds.color || getColor(this.palette, di);
        inner += `<path d="${roundRect(x, y, barW - 1, barH, 3)}" fill="${color}" opacity="0.9"/>`;
      });
      inner += this._tickLabel(label, m.left + li * groupW + groupW / 2, m.top + ch + 18);
    });

    // Legend
    datasets.forEach((ds, i) => {
      const lx = w - m.right - 100;
      const ly = m.top + 10 + i * 20;
      inner += `<rect x="${lx}" y="${ly}" width="12" height="12" rx="2" fill="${ds.color || getColor(this.palette, i)}"/>`;
      inner += this._tickLabel(ds.label, lx + 18, ly + 10, 'start');
    });

    return svgWrap(w, h, inner, this.bg);
  }

  // ── Line Chart ──────────────────────────────────────────────────────

  line(datasets, opts = {}) {
    // datasets: [{ label, data: [y1,y2,...], color?, dashed? }]
    // opts.labels: ['Jan','Feb',...]
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;

    let inner = this._title(opts.title, w);
    const allVals = datasets.flatMap(d => d.data);
    const [yMin, yMax] = minMax(allVals);
    const yRange = (yMax - yMin) || 1;
    const yPad = yRange * 0.1;
    const yFloor = yMin - yPad;
    const yCeil = yMax + yPad;
    const n = datasets[0].data.length;
    const labels = opts.labels || Array.from({ length: n }, (_, i) => String(i));

    // Y axis
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = m.top + ch - (ch * i / yTicks);
      const val = (yFloor + (yCeil - yFloor) * i / yTicks).toFixed(opts.precision ?? 1);
      inner += this._gridLine(m.left, y, w - m.right, y);
      inner += this._tickLabel(val, m.left - 8, y + 4, 'end');
    }

    // X axis labels (skip if too many)
    const skipEvery = labels.length > 20 ? Math.ceil(labels.length / 15) : 1;
    labels.forEach((label, i) => {
      if (i % skipEvery !== 0 && i !== labels.length - 1) return;
      const x = m.left + (i / (n - 1)) * cw;
      inner += this._tickLabel(label, x, m.top + ch + 18);
    });

    // Lines
    datasets.forEach((ds, di) => {
      const color = ds.color || getColor(this.palette, di);
      const dashAttr = ds.dashed ? ' stroke-dasharray="6,3"' : '';
      const points = ds.data.map((v, i) => {
        const x = m.left + (i / (n - 1)) * cw;
        const y = m.top + ch - ((v - yFloor) / (yCeil - yFloor)) * ch;
        return `${x},${y}`;
      });

      // Area fill
      if (opts.area) {
        const areaPoints = [...points, `${m.left + cw},${m.top + ch}`, `${m.left},${m.top + ch}`];
        inner += `<polygon points="${areaPoints.join(' ')}" fill="${color}" opacity="0.1"/>`;
      }

      inner += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2"${dashAttr}/>`;

      // Data points
      if (opts.dots) {
        ds.data.forEach((v, i) => {
          const x = m.left + (i / (n - 1)) * cw;
          const y = m.top + ch - ((v - yFloor) / (yCeil - yFloor)) * ch;
          inner += `<circle cx="${x}" cy="${y}" r="3" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
        });
      }
    });

    // Legend
    if (datasets.length > 1) {
      datasets.forEach((ds, i) => {
        const lx = m.left + 10;
        const ly = m.top + 10 + i * 20;
        inner += `<rect x="${lx}" y="${ly}" width="12" height="12" rx="2" fill="${ds.color || getColor(this.palette, i)}"/>`;
        inner += this._tickLabel(ds.label, lx + 18, ly + 10, 'start');
      });
    }

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'line', svg, data: datasets });
    this.emit('chart', { id, type: 'line' });
    return svg;
  }

  // ── Pie / Donut Chart ──────────────────────────────────────────────

  pie(data, opts = {}) {
    // data: [{ label, value, color? }]
    const items = Array.isArray(data) ? data : data.labels.map((l, i) => ({ label: l, value: data.values[i] }));
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const cx = w / 2;
    const cy = h / 2 + 15;
    const r = Math.min(w, h) / 2 - 60;
    const innerR = opts.donut ? r * (opts.donutRatio || 0.5) : 0;
    const total = items.reduce((s, d) => s + d.value, 0);

    let inner = this._title(opts.title, w);
    let startAngle = -Math.PI / 2;

    items.forEach((d, i) => {
      const sweep = (d.value / total) * Math.PI * 2;
      const endAngle = startAngle + sweep;
      const largeArc = sweep > Math.PI ? 1 : 0;
      const color = d.color || getColor(this.palette, i);

      // Outer arc
      const x1o = cx + r * Math.cos(startAngle);
      const y1o = cy + r * Math.sin(startAngle);
      const x2o = cx + r * Math.cos(endAngle);
      const y2o = cy + r * Math.sin(endAngle);

      let path;
      if (innerR > 0) {
        const x1i = cx + innerR * Math.cos(startAngle);
        const y1i = cy + innerR * Math.sin(startAngle);
        const x2i = cx + innerR * Math.cos(endAngle);
        const y2i = cy + innerR * Math.sin(endAngle);
        path = `M${x1o},${y1o} A${r},${r} 0 ${largeArc} 1 ${x2o},${y2o} L${x2i},${y2i} A${innerR},${innerR} 0 ${largeArc} 0 ${x1i},${y1i} Z`;
      } else {
        path = `M${cx},${cy} L${x1o},${y1o} A${r},${r} 0 ${largeArc} 1 ${x2o},${y2o} Z`;
      }

      inner += `<path d="${path}" fill="${color}" stroke="#fff" stroke-width="2"/>`;

      // Label
      if (opts.labels !== false) {
        const midAngle = startAngle + sweep / 2;
        const labelR = r + 20;
        const lx = cx + labelR * Math.cos(midAngle);
        const ly = cy + labelR * Math.sin(midAngle);
        const pct = ((d.value / total) * 100).toFixed(1);
        inner += `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#333">${esc(d.label)} (${pct}%)</text>`;
      }

      startAngle = endAngle;
    });

    // Center label for donut
    if (opts.donut && opts.centerLabel) {
      inner += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.fontSize + 2}" fill="#999">${esc(opts.centerLabel)}</text>`;
      inner += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.titleSize}" font-weight="600" fill="#333">${opts.centerValue || total}</text>`;
    }

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'pie', svg, data: items });
    this.emit('chart', { id, type: 'pie' });
    return svg;
  }

  donut(data, opts = {}) { return this.pie(data, { ...opts, donut: true }); }

  // ── Scatter Plot ────────────────────────────────────────────────────

  scatter(datasets, opts = {}) {
    // datasets: [{ label, data: [{ x, y, r? }], color? }]
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;

    let inner = this._title(opts.title, w);
    const allPts = datasets.flatMap(d => d.data);
    const [xMin, xMax] = minMax(allPts.map(p => p.x));
    const [yMin, yMax] = minMax(allPts.map(p => p.y));
    const xPad = (xMax - xMin) * 0.1 || 1;
    const yPad = (yMax - yMin) * 0.1 || 1;

    // Grid
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const y = m.top + ch - (ch * i / ticks);
      const val = (yMin - yPad + (yMax - yMin + 2 * yPad) * i / ticks).toFixed(1);
      inner += this._gridLine(m.left, y, w - m.right, y);
      inner += this._tickLabel(val, m.left - 8, y + 4, 'end');

      const x = m.left + (cw * i / ticks);
      const xVal = (xMin - xPad + (xMax - xMin + 2 * xPad) * i / ticks).toFixed(1);
      inner += this._tickLabel(xVal, x, m.top + ch + 18);
    }

    // Points
    datasets.forEach((ds, di) => {
      const color = ds.color || getColor(this.palette, di);
      ds.data.forEach(p => {
        const px = m.left + ((p.x - xMin + xPad) / (xMax - xMin + 2 * xPad)) * cw;
        const py = m.top + ch - ((p.y - yMin + yPad) / (yMax - yMin + 2 * yPad)) * ch;
        const r = p.r || (opts.pointRadius || 5);
        inner += `<circle cx="${px}" cy="${py}" r="${r}" fill="${color}" opacity="0.7"/>`;
      });
    });

    // Legend
    if (datasets.length > 1) {
      datasets.forEach((ds, i) => {
        const lx = m.left + 10;
        const ly = m.top + 10 + i * 20;
        inner += `<circle cx="${lx + 6}" cy="${ly + 6}" r="5" fill="${ds.color || getColor(this.palette, i)}"/>`;
        inner += this._tickLabel(ds.label, lx + 18, ly + 10, 'start');
      });
    }

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'scatter', svg, data: datasets });
    this.emit('chart', { id, type: 'scatter' });
    return svg;
  }

  // ── Sparkline ───────────────────────────────────────────────────────

  sparkline(data, opts = {}) {
    const w = opts.width || 200;
    const h = opts.height || 50;
    const color = opts.color || getColor(this.palette, 0);
    const showArea = opts.area !== false;
    const showDots = opts.dots || false;
    const [yMin, yMax] = minMax(data);
    const yRange = (yMax - yMin) || 1;
    const pad = 4;

    const points = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - yMin) / yRange) * (h - 2 * pad);
      return { x, y };
    });

    let inner = '';
    if (showArea) {
      const area = [...points, { x: points[points.length - 1].x, y: h - pad }, { x: pad, y: h - pad }];
      inner += `<polygon points="${area.map(p => `${p.x},${p.y}`).join(' ')}" fill="${color}" opacity="0.15"/>`;
    }
    inner += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`;

    if (showDots) {
      points.forEach(p => { inner += `<circle cx="${p.x}" cy="${p.y}" r="2" fill="${color}"/>`; });
    }

    // Last value indicator
    if (opts.showLast) {
      const last = points[points.length - 1];
      inner += `<circle cx="${last.x}" cy="${last.y}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`;
      inner += `<text x="${last.x - 4}" y="${last.y - 6}" text-anchor="end" font-family="${this.fontFamily}" font-size="10" fill="${color}">${data[data.length - 1]}</text>`;
    }

    return svgWrap(w, h, inner, opts.bg || 'transparent');
  }

  // ── Heatmap ─────────────────────────────────────────────────────────

  heatmap(matrix, opts = {}) {
    // matrix: [[v1,v2,...],[...]] — rows × cols
    // opts.rowLabels, opts.colLabels
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const rows = matrix.length;
    const cols = matrix[0].length;
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;
    const cellW = cw / cols;
    const cellH = ch / rows;
    const allVals = matrix.flat();
    const [minVal, maxVal] = minMax(allVals);
    const colorStart = opts.colorStart || '#e8f4f8';
    const colorEnd = opts.colorEnd || '#1a5276';

    let inner = this._title(opts.title, w);

    // Helper to interpolate hex color
    const colorLerp = (v) => {
      const t = maxVal === minVal ? 0.5 : (v - minVal) / (maxVal - minVal);
      const r1 = parseInt(colorStart.slice(1, 3), 16), g1 = parseInt(colorStart.slice(3, 5), 16), b1 = parseInt(colorStart.slice(5, 7), 16);
      const r2 = parseInt(colorEnd.slice(1, 3), 16), g2 = parseInt(colorEnd.slice(3, 5), 16), b2 = parseInt(colorEnd.slice(5, 7), 16);
      const r = Math.round(lerp(r1, r2, t)), g = Math.round(lerp(g1, g2, t)), b = Math.round(lerp(b1, b2, t));
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    };

    matrix.forEach((row, ri) => {
      row.forEach((val, ci) => {
        const x = m.left + ci * cellW;
        const y = m.top + ri * cellH;
        const fill = colorLerp(val);
        const textColor = ((val - minVal) / (maxVal - minVal || 1)) > 0.5 ? '#fff' : '#333';
        inner += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
        if (opts.showValues !== false && cellW > 30 && cellH > 20) {
          inner += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${Math.min(11, cellW / 3)}" fill="${textColor}">${val}</text>`;
        }
      });

      // Row label
      if (opts.rowLabels && opts.rowLabels[ri]) {
        inner += this._tickLabel(opts.rowLabels[ri], m.left - 8, m.top + ri * cellH + cellH / 2 + 4, 'end');
      }
    });

    // Column labels
    if (opts.colLabels) {
      opts.colLabels.forEach((label, ci) => {
        inner += this._tickLabel(label, m.left + ci * cellW + cellW / 2, m.top + ch + 16);
      });
    }

    // Color legend
    const legW = 20, legH = ch;
    const legX = w - m.right + 15;
    for (let i = 0; i < legH; i++) {
      const t = i / legH;
      inner += `<rect x="${legX}" y="${m.top + i}" width="${legW}" height="1" fill="${colorLerp(lerp(maxVal, minVal, t))}"/>`;
    }
    inner += this._tickLabel(maxVal.toFixed(1), legX + legW + 4, m.top + 10, 'start');
    inner += this._tickLabel(minVal.toFixed(1), legX + legW + 4, m.top + legH, 'start');

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'heatmap', svg, data: matrix });
    this.emit('chart', { id, type: 'heatmap' });
    return svg;
  }

  // ── Gauge ───────────────────────────────────────────────────────────

  gauge(value, opts = {}) {
    const w = opts.width || 300;
    const h = opts.height || 200;
    const cx = w / 2;
    const cy = h - 30;
    const r = Math.min(w / 2, h) - 30;
    const min = opts.min ?? 0;
    const max = opts.max ?? 100;
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const startAngle = Math.PI;
    const endAngle = 0;
    const needleAngle = startAngle + t * (endAngle - startAngle);

    let inner = this._title(opts.title, w);

    // Background arc
    const bgArc = `M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`;
    inner += `<path d="${bgArc}" fill="none" stroke="#eee" stroke-width="20" stroke-linecap="round"/>`;

    // Value arc
    const needleX = cx + r * Math.cos(needleAngle);
    const needleY = cy + r * Math.sin(needleAngle);
    const largeArc = t > 0.5 ? 1 : 0;
    const valColor = t > 0.8 ? '#e74c3c' : t > 0.6 ? '#f39c12' : '#27ae60';
    const valArc = `M${cx - r},${cy} A${r},${r} 0 ${largeArc} 1 ${needleX},${needleY}`;
    inner += `<path d="${valArc}" fill="none" stroke="${valColor}" stroke-width="20" stroke-linecap="round"/>`;

    // Needle
    inner += `<line x1="${cx}" y1="${cy}" x2="${cx + (r - 15) * Math.cos(needleAngle)}" y2="${cy + (r - 15) * Math.sin(needleAngle)}" stroke="#333" stroke-width="2.5" stroke-linecap="round"/>`;
    inner += `<circle cx="${cx}" cy="${cy}" r="6" fill="#333"/>`;

    // Labels
    inner += this._tickLabel(String(min), cx - r - 5, cy + 18, 'middle');
    inner += this._tickLabel(String(max), cx + r + 5, cy + 18, 'middle');
    inner += `<text x="${cx}" y="${cy - 20}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.titleSize + 4}" font-weight="700" fill="${valColor}">${value}${opts.unit || ''}</text>`;

    if (opts.label) {
      inner += `<text x="${cx}" y="${cy + 35}" text-anchor="middle" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#999">${esc(opts.label)}</text>`;
    }

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'gauge', svg, data: { value, min, max } });
    this.emit('chart', { id, type: 'gauge' });
    return svg;
  }

  // ── Radar / Spider Chart ────────────────────────────────────────────

  radar(datasets, opts = {}) {
    // datasets: [{ label, data: [v1, v2, ...], color? }]
    // opts.labels: ['Speed', 'Power', ...]
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const r = Math.min(w, h) / 2 - 60;
    const labels = opts.labels || datasets[0].data.map((_, i) => `Axis ${i + 1}`);
    const n = labels.length;
    const maxVal = Math.max(...datasets.flatMap(d => d.data), opts.max || 1);

    let inner = this._title(opts.title, w);

    // Grid rings
    const rings = 5;
    for (let ring = 1; ring <= rings; ring++) {
      const rr = (ring / rings) * r;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        pts.push(`${cx + rr * Math.cos(angle)},${cy + rr * Math.sin(angle)}`);
      }
      inner += `<polygon points="${pts.join(' ')}" fill="none" stroke="#eee" stroke-width="1"/>`;
    }

    // Axis lines + labels
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      inner += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#ddd" stroke-width="1"/>`;
      const lx = cx + (r + 18) * Math.cos(angle);
      const ly = cy + (r + 18) * Math.sin(angle);
      const anchor = Math.abs(Math.cos(angle)) < 0.1 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      inner += `<text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#666">${esc(labels[i])}</text>`;
    }

    // Data polygons
    datasets.forEach((ds, di) => {
      const color = ds.color || getColor(this.palette, di);
      const pts = ds.data.map((v, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const rr = (v / maxVal) * r;
        return `${cx + rr * Math.cos(angle)},${cy + rr * Math.sin(angle)}`;
      });
      inner += `<polygon points="${pts.join(' ')}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2"/>`;
      if (opts.dots) {
        ds.data.forEach((v, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const rr = (v / maxVal) * r;
          inner += `<circle cx="${cx + rr * Math.cos(angle)}" cy="${cy + rr * Math.sin(angle)}" r="3" fill="${color}"/>`;
        });
      }
    });

    // Legend
    if (datasets.length > 1) {
      datasets.forEach((ds, i) => {
        const lx = m_left(w) + 10;
        const ly = 45 + i * 20;
        inner += `<rect x="${lx}" y="${ly}" width="12" height="12" rx="2" fill="${ds.color || getColor(this.palette, i)}"/>`;
        inner += this._tickLabel(ds.label, lx + 18, ly + 10, 'start');
      });
    }

    const id = this._id();
    const svg = svgWrap(w, h, inner, this.bg);
    this.charts.set(id, { type: 'radar', svg, data: datasets });
    this.emit('chart', { id, type: 'radar' });
    return svg;
  }

  // ── Stacked Area Chart ──────────────────────────────────────────────

  areaStacked(datasets, opts = {}) {
    // datasets: [{ label, data: [y1,y2,...], color? }]
    const w = opts.width || this.width;
    const h = opts.height || this.height;
    const m = { ...this.margin };
    const cw = w - m.left - m.right;
    const ch = h - m.top - m.bottom;
    const n = datasets[0].data.length;
    const labels = opts.labels || Array.from({ length: n }, (_, i) => String(i));

    let inner = this._title(opts.title, w);

    // Compute stacked values
    const stacked = [];
    for (let i = 0; i < n; i++) {
      let cumulative = 0;
      for (const ds of datasets) {
        cumulative += ds.data[i];
      }
      stacked.push(cumulative);
    }
    const yMax = Math.max(...stacked) * 1.05;

    // Y axis
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = m.top + ch - (ch * i / yTicks);
      const val = (yMax * i / yTicks).toFixed(0);
      inner += this._gridLine(m.left, y, w - m.right, y);
      inner += this._tickLabel(val, m.left - 8, y + 4, 'end');
    }

    // Stacked areas (draw from bottom to top)
    for (let di = datasets.length - 1; di >= 0; di--) {
      const color = datasets[di].color || getColor(this.palette, di);
      // Top line
      const topPts = [];
      const bottomPts = [];
      for (let i = 0; i < n; i++) {
        const x = m.left + (i / (n - 1)) * cw;
        let cumulative = 0;
        for (let j = 0; j <= di; j++) cumulative += datasets[j].data[i];
        topPts.push(`${x},${m.top + ch - (cumulative / yMax) * ch}`);
        cumulative = 0;
        for (let j = 0; j < di; j++) cumulative += datasets[j].data[i];
        bottomPts.push(`${x},${m.top + ch - (cumulative / yMax) * ch}`);
      }
      const areaPoints = [...topPts, ...bottomPts.reverse()];
      inner += `<polygon points="${areaPoints.join(' ')}" fill="${color}" opacity="0.7"/>`;
    }

    // X labels
    const skipEvery = labels.length > 20 ? Math.ceil(labels.length / 15) : 1;
    labels.forEach((label, i) => {
      if (i % skipEvery !== 0 && i !== labels.length - 1) return;
      const x = m.left + (i / (n - 1)) * cw;
      inner += this._tickLabel(label, x, m.top + ch + 18);
    });

    // Legend
    datasets.forEach((ds, i) => {
      const lx = m.left + 10;
      const ly = m.top + 10 + i * 20;
      inner += `<rect x="${lx}" y="${ly}" width="12" height="12" rx="2" fill="${ds.color || getColor(this.palette, i)}"/>`;
      inner += this._tickLabel(ds.label, lx + 18, ly + 10, 'start');
    });

    return svgWrap(w, h, inner, this.bg);
  }

  // ── KPI / Big Number Card ───────────────────────────────────────────

  kpi(items, opts = {}) {
    // items: [{ label, value, change?, changeLabel?, color?, icon? }]
    const w = opts.width || this.width;
    const cols = items.length;
    const cardW = (w - 40) / cols;
    const cardH = opts.height || 120;
    const h = cardH + 40;

    let inner = this._title(opts.title, w);

    items.forEach((item, i) => {
      const x = 20 + i * cardW;
      const y = 45;
      const color = item.color || getColor(this.palette, i);

      inner += `<rect x="${x}" y="${y}" width="${cardW - 10}" height="${cardH}" rx="8" fill="#f8f9fa" stroke="#eee" stroke-width="1"/>`;
      inner += `<text x="${x + 15}" y="${y + 28}" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="#999">${esc(item.label)}</text>`;
      inner += `<text x="${x + 15}" y="${y + 60}" font-family="${this.fontFamily}" font-size="28" font-weight="700" fill="${color}">${esc(String(item.value))}</text>`;

      if (item.change !== undefined) {
        const arrow = item.change >= 0 ? '▲' : '▼';
        const changeColor = item.change >= 0 ? '#27ae60' : '#e74c3c';
        inner += `<text x="${x + 15}" y="${y + 85}" font-family="${this.fontFamily}" font-size="${this.fontSize}" fill="${changeColor}">${arrow} ${Math.abs(item.change)}% ${item.changeLabel || ''}</text>`;
      }
    });

    return svgWrap(w, h, inner, this.bg);
  }

  // ── Table ───────────────────────────────────────────────────────────

  table(columns, rows, opts = {}) {
    // columns: [{ key, label, width?, align? }]
    // rows: [{ key1: val1, key2: val2 }, ...]
    const w = opts.width || this.width;
    const rowH = 32;
    const headerH = 38;
    const m = { top: 50, right: 20, bottom: 20, left: 20 };
    const cw = w - m.left - m.right;
    const h = m.top + headerH + rows.length * rowH + m.bottom;

    let inner = this._title(opts.title, w);
    const colW = cw / columns.length;

    // Header
    inner += `<rect x="${m.left}" y="${m.top}" width="${cw}" height="${headerH}" fill="#f0f0f0" rx="4"/>`;
    columns.forEach((col, ci) => {
      const x = m.left + ci * colW + 10;
      inner += `<text x="${x}" y="${m.top + 24}" font-family="${this.fontFamily}" font-size="${this.fontSize}" font-weight="600" fill="#333">${esc(col.label || col.key)}</text>`;
    });

    // Rows
    rows.forEach((row, ri) => {
      const y = m.top + headerH + ri * rowH;
      const bg = ri % 2 === 0 ? '#fff' : '#fafafa';
      inner += `<rect x="${m.left}" y="${y}" width="${cw}" height="${rowH}" fill="${bg}"/>`;
      columns.forEach((col, ci) => {
        const x = m.left + ci * colW + 10;
        const val = row[col.key] ?? '';
        const align = col.align || 'left';
        const anchor = align === 'right' ? 'end' : align === 'center' ? 'middle' : 'start';
        const textX = align === 'right' ? m.left + (ci + 1) * colW - 10 : align === 'center' ? m.left + ci * colW + colW / 2 : x;
        inner += `<text x="${textX}" y="${y + 20}" text-anchor="${anchor}" font-family="${this.fontFamily}" font-size="${this.fontSize - 1}" fill="#555">${esc(String(val))}</text>`;
      });
    });

    // Border
    inner += `<rect x="${m.left}" y="${m.top}" width="${cw}" height="${headerH + rows.length * rowH}" fill="none" stroke="#ddd" stroke-width="1" rx="4"/>`;

    return svgWrap(w, h, inner, this.bg);
  }

  // ── Composite Dashboard ─────────────────────────────────────────────

  dashboard(charts, opts = {}) {
    // charts: [{ type, data, opts, x, y, w, h }]
    const w = opts.width || this.width;
    const h = opts.height || (opts.rows || 2) * 300;
    let inner = this._title(opts.title, w);

    charts.forEach(c => {
      const eng = new VisualizeEngine({ width: c.w || 400, height: c.h || 300, palette: this.palette, bg: 'transparent' });
      const svg = eng[c.type](c.data, c.opts || {});
      // Extract inner content
      const match = svg.match(/<rect[^/]*\/>([\s\S]*)<\/svg>/);
      if (match) {
        inner += `<g transform="translate(${c.x || 0}, ${(c.y || 0) + 40})">${match[1]}</g>`;
      }
    });

    return svgWrap(w, h, inner, this.bg);
  }

  // ── Utility: get chart by ID ────────────────────────────────────────

  get(id) { return this.charts.get(id); }
  list() { return [...this.charts.entries()].map(([id, c]) => ({ id, type: c.type })); }
  clear() { this.charts.clear(); }
}

function m_left(w) { return 60; }

// ─── Exports ───────────────────────────────────────────────────────────────

export { PALETTES };
export function create(opts) { return new VisualizeEngine(opts); }
export default VisualizeEngine;

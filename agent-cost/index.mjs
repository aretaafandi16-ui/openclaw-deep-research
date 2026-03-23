/**
 * agent-cost — Zero-dependency cost tracker for AI agents
 * 
 * Tracks token usage, calculates costs across providers,
 * enforces budgets, and provides real-time analytics.
 * 
 * @module agent-cost
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

// ─── Provider Pricing (per 1K tokens, USD) ───────────────────────────
export const PRICING = {
  'openai': {
    'gpt-4o':              { input: 0.0025,  output: 0.01   },
    'gpt-4o-mini':         { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo':         { input: 0.01,    output: 0.03   },
    'gpt-4':               { input: 0.03,    output: 0.06   },
    'gpt-3.5-turbo':       { input: 0.0005,  output: 0.0015 },
    'o1':                  { input: 0.015,   output: 0.06   },
    'o1-mini':             { input: 0.003,   output: 0.012  },
    'o1-preview':          { input: 0.015,   output: 0.06   },
    'o3-mini':             { input: 0.0011,  output: 0.0044 },
  },
  'anthropic': {
    'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
    'claude-3-7-sonnet-20250219': { input: 0.003, output: 0.015 },
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku-20241022':  { input: 0.0008, output: 0.004 },
    'claude-3-opus-20240229':  { input: 0.015,  output: 0.075 },
    'claude-3-sonnet-20240229': { input: 0.003,  output: 0.015 },
    'claude-3-haiku-20240307':  { input: 0.00025, output: 0.00125 },
  },
  'google': {
    'gemini-1.5-pro':   { input: 0.00125, output: 0.005  },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    'gemini-2.0-flash': { input: 0.0001,  output: 0.0004 },
    'gemini-2.5-pro':   { input: 0.00125, output: 0.01   },
    'gemini-2.5-flash': { input: 0.00015, output: 0.0006 },
  },
  'mistral': {
    'mistral-large-latest':    { input: 0.002,  output: 0.006  },
    'mistral-medium-latest':   { input: 0.0027, output: 0.0081 },
    'mistral-small-latest':    { input: 0.001,  output: 0.003  },
    'codestral-latest':        { input: 0.001,  output: 0.003  },
  },
  'groq': {
    'llama-3.1-70b-versatile': { input: 0.00059, output: 0.00079 },
    'llama-3.1-8b-instant':    { input: 0.00005, output: 0.00008 },
    'mixtral-8x7b-32768':      { input: 0.00024, output: 0.00024 },
  },
  'deepseek': {
    'deepseek-chat':   { input: 0.00014, output: 0.00028 },
    'deepseek-coder':  { input: 0.00014, output: 0.00028 },
    'deepseek-r1':     { input: 0.00055, output: 0.00219 },
  },
  'xai': {
    'grok-2':        { input: 0.002,  output: 0.01  },
    'grok-2-mini':   { input: 0.0003, output: 0.0005 },
  },
  'cohere': {
    'command-r-plus': { input: 0.0025, output: 0.01  },
    'command-r':      { input: 0.0005, output: 0.0015 },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function periodBounds(period, from) {
  const now = from || Date.now();
  const d = new Date(now);
  
  if (period === 'day') {
    d.setHours(0, 0, 0, 0);
    return [d.getTime(), d.getTime() + 86400000];
  }
  if (period === 'week') {
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return [d.getTime(), d.getTime() + 7 * 86400000];
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setMonth(end.getMonth() + 1);
  return [d.getTime(), end.getTime()];
}

// ─── CostTracker ─────────────────────────────────────────────────────

export class CostTracker extends EventEmitter {
  #records = [];
  #budgets = {};
  #dataPath;
  #customPricing = {};

  constructor(opts = {}) {
    super();
    this.#dataPath = opts.dataPath || join(process.cwd(), '.agent-cost');
    this.#budgets = opts.budgets || {};
    if (opts.pricing) {
      this.#customPricing = opts.pricing;
    }
    this.#load();
  }

  // ─── Core ───────────────────────────────────────────────────────

  /**
   * Record a usage event. Returns the created record with cost calculated.
   */
  record(provider, model, inputTokens, outputTokens, metadata) {
    const price = this.#getPrice(provider, model);
    const inputCost = (inputTokens / 1000) * price.input;
    const outputCost = (outputTokens / 1000) * price.output;
    const totalCost = inputCost + outputCost;

    // Budget check
    if (this.#budgets.hardLimit) {
      this.#checkBudgetsThrow(totalCost);
    } else {
      this.#checkBudgetsWarn(totalCost);
    }

    const record = {
      id: genId(),
      timestamp: Date.now(),
      provider,
      model,
      inputTokens,
      outputTokens,
      inputCost: Math.round(inputCost * 1e8) / 1e8,
      outputCost: Math.round(outputCost * 1e8) / 1e8,
      totalCost: Math.round(totalCost * 1e8) / 1e8,
      metadata,
    };

    this.#records.push(record);
    this.emit('record', record);
    this.#persist();
    return record;
  }

  /**
   * Estimate cost without recording.
   */
  estimate(provider, model, inputTokens, outputTokens) {
    const price = this.#getPrice(provider, model);
    const inputCost = (inputTokens / 1000) * price.input;
    const outputCost = (outputTokens / 1000) * price.output;
    return {
      provider,
      model,
      inputTokens,
      outputTokens,
      inputCost: Math.round(inputCost * 1e8) / 1e8,
      outputCost: Math.round(outputCost * 1e8) / 1e8,
      totalCost: Math.round((inputCost + outputCost) * 1e8) / 1e8,
    };
  }

  /**
   * Find cheapest provider/model for given token counts.
   */
  findCheapest(inputTokens, outputTokens, opts = {}) {
    const estimates = [];
    const providers = opts.provider ? { [opts.provider]: this.#getAllPricing()[opts.provider] || {} } : this.#getAllPricing();

    for (const [provider, models] of Object.entries(providers)) {
      for (const [model, prices] of Object.entries(models)) {
        const est = this.estimate(provider, model, inputTokens, outputTokens);
        if (!opts.maxCost || est.totalCost <= opts.maxCost) {
          estimates.push(est);
        }
      }
    }

    return estimates.sort((a, b) => a.totalCost - b.totalCost);
  }

  // ─── Querying ───────────────────────────────────────────────────

  /**
   * Get usage statistics for a time period.
   */
  stats(period, from) {
    let filtered = this.#records;
    let periodStart = 0;
    let periodEnd = Date.now();

    if (period) {
      [periodStart, periodEnd] = periodBounds(period, from);
      filtered = this.#records.filter(r => r.timestamp >= periodStart && r.timestamp < periodEnd);
    } else if (filtered.length > 0) {
      periodStart = filtered[0].timestamp;
      periodEnd = filtered[filtered.length - 1].timestamp;
    }

    const byProvider = {};
    const byModel = {};
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const r of filtered) {
      totalCost += r.totalCost;
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;

      if (!byProvider[r.provider]) byProvider[r.provider] = { requests: 0, cost: 0, tokens: 0 };
      byProvider[r.provider].requests++;
      byProvider[r.provider].cost += r.totalCost;
      byProvider[r.provider].tokens += r.inputTokens + r.outputTokens;

      const modelKey = `${r.provider}/${r.model}`;
      if (!byModel[modelKey]) byModel[modelKey] = { requests: 0, cost: 0, tokens: 0 };
      byModel[modelKey].requests++;
      byModel[modelKey].cost += r.totalCost;
      byModel[modelKey].tokens += r.inputTokens + r.outputTokens;
    }

    return {
      totalRequests: filtered.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCost: Math.round(totalCost * 1e6) / 1e6,
      byProvider,
      byModel,
      avgCostPerRequest: filtered.length ? Math.round((totalCost / filtered.length) * 1e8) / 1e8 : 0,
      avgTokensPerRequest: filtered.length ? Math.round((totalInput + totalOutput) / filtered.length) : 0,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get budget status for all configured periods.
   */
  budgetStatus() {
    const statuses = [];
    const now = Date.now();

    if (this.#budgets.daily !== undefined) {
      const [start, end] = periodBounds('day');
      const spent = this.#sumCosts(start, now);
      const hoursElapsed = (now - start) / 3600000;
      const projected = hoursElapsed > 0 ? (spent / hoursElapsed) * 24 : 0;
      statuses.push({
        period: 'daily', limit: this.#budgets.daily,
        spent: Math.round(spent * 1e6) / 1e6,
        remaining: Math.round((this.#budgets.daily - spent) * 1e6) / 1e6,
        percentUsed: Math.round((spent / this.#budgets.daily) * 10000) / 100,
        exceeded: spent > this.#budgets.daily,
        projectedEnd: Math.round(projected * 1e6) / 1e6,
      });
    }

    if (this.#budgets.weekly !== undefined) {
      const [start, end] = periodBounds('week');
      const spent = this.#sumCosts(start, now);
      const hoursElapsed = (now - start) / 3600000;
      const totalHours = 7 * 24;
      const projected = hoursElapsed > 0 ? (spent / hoursElapsed) * totalHours : 0;
      statuses.push({
        period: 'weekly', limit: this.#budgets.weekly,
        spent: Math.round(spent * 1e6) / 1e6,
        remaining: Math.round((this.#budgets.weekly - spent) * 1e6) / 1e6,
        percentUsed: Math.round((spent / this.#budgets.weekly) * 10000) / 100,
        exceeded: spent > this.#budgets.weekly,
        projectedEnd: Math.round(projected * 1e6) / 1e6,
      });
    }

    if (this.#budgets.monthly !== undefined) {
      const [start, end] = periodBounds('month');
      const spent = this.#sumCosts(start, now);
      const daysElapsed = (now - start) / 86400000;
      const daysInMonth = (end - start) / 86400000;
      const projected = daysElapsed > 0 ? (spent / daysElapsed) * daysInMonth : 0;
      statuses.push({
        period: 'monthly', limit: this.#budgets.monthly,
        spent: Math.round(spent * 1e6) / 1e6,
        remaining: Math.round((this.#budgets.monthly - spent) * 1e6) / 1e6,
        percentUsed: Math.round((spent / this.#budgets.monthly) * 10000) / 100,
        exceeded: spent > this.#budgets.monthly,
        projectedEnd: Math.round(projected * 1e6) / 1e6,
      });
    }

    return statuses;
  }

  /**
   * Get recent records.
   */
  recent(limit = 20) {
    return this.#records.slice(-limit).reverse();
  }

  /**
   * Get all records (for export).
   */
  allRecords() {
    return [...this.#records];
  }

  /**
   * Clear all records.
   */
  clear() {
    this.#records = [];
    this.#persist();
    this.emit('clear');
  }

  /**
   * Export records to CSV string.
   */
  toCSV() {
    const header = 'id,timestamp,provider,model,input_tokens,output_tokens,input_cost,output_cost,total_cost';
    const rows = this.#records.map(r =>
      `${r.id},${new Date(r.timestamp).toISOString()},${r.provider},${r.model},${r.inputTokens},${r.outputTokens},${r.inputCost},${r.outputCost},${r.totalCost}`
    );
    return [header, ...rows].join('\n');
  }

  // ─── Budget Management ──────────────────────────────────────────

  setBudget(budget) {
    this.#budgets = { ...this.#budgets, ...budget };
    this.#persist();
    this.emit('budget:update', this.#budgets);
  }

  getBudget() {
    return { ...this.#budgets };
  }

  // ─── Custom Pricing ─────────────────────────────────────────────

  addPricing(provider, model, inputPer1k, outputPer1k) {
    if (!this.#customPricing[provider]) this.#customPricing[provider] = {};
    this.#customPricing[provider][model] = { input: inputPer1k, output: outputPer1k };
    this.#persist();
  }

  listModels(provider) {
    const all = this.#getAllPricing();
    const result = {};
    const src = provider ? { [provider]: all[provider] } : all;
    for (const [p, models] of Object.entries(src)) {
      if (models) result[p] = Object.keys(models);
    }
    return result;
  }

  // ─── Private ────────────────────────────────────────────────────

  #getPrice(provider, model) {
    const all = this.#getAllPricing();
    const prov = all[provider.toLowerCase()];
    if (!prov) throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(all).join(', ')}`);
    const price = prov[model] || prov[model.split('/').pop()];
    if (!price) {
      const modelKey = Object.keys(prov).find(k => model.includes(k) || k.includes(model));
      if (modelKey) return prov[modelKey];
      throw new Error(`Unknown model: ${model} for provider: ${provider}. Available: ${Object.keys(prov).join(', ')}`);
    }
    return price;
  }

  #getAllPricing() {
    const merged = JSON.parse(JSON.stringify(PRICING));
    for (const [prov, models] of Object.entries(this.#customPricing)) {
      if (!merged[prov]) merged[prov] = {};
      Object.assign(merged[prov], models);
    }
    return merged;
  }

  #sumCosts(start, end) {
    return this.#records
      .filter(r => r.timestamp >= start && r.timestamp < end)
      .reduce((sum, r) => sum + r.totalCost, 0);
  }

  #checkBudgetsThrow(additionalCost) {
    const now = Date.now();
    if (this.#budgets.daily !== undefined) {
      const [start] = periodBounds('day');
      const spent = this.#sumCosts(start, now);
      if (spent + additionalCost > this.#budgets.daily) {
        throw new Error(`Daily budget exceeded: $${spent.toFixed(4)} + $${additionalCost.toFixed(4)} > $${this.#budgets.daily}`);
      }
    }
    if (this.#budgets.monthly !== undefined) {
      const [start] = periodBounds('month');
      const spent = this.#sumCosts(start, now);
      if (spent + additionalCost > this.#budgets.monthly) {
        throw new Error(`Monthly budget exceeded: $${spent.toFixed(4)} + $${additionalCost.toFixed(4)} > $${this.#budgets.monthly}`);
      }
    }
  }

  #checkBudgetsWarn(additionalCost) {
    const now = Date.now();
    const thresholds = [50, 75, 90, 95, 100];
    
    for (const [key, limit] of Object.entries(this.#budgets)) {
      if (key === 'hardLimit' || key === 'perRequest' || !limit) continue;
      const period = key === 'daily' ? 'day' : key === 'weekly' ? 'week' : 'month';
      const [start] = periodBounds(period);
      const spent = this.#sumCosts(start, now) + additionalCost;
      const pct = (spent / limit) * 100;
      
      for (const t of thresholds) {
        if (pct >= t && pct - (additionalCost / limit * 100) < t) {
          this.emit('budget:warning', { period: key, percentUsed: Math.round(pct * 100) / 100, limit, spent: Math.round(spent * 1e6) / 1e6, threshold: t });
        }
      }
    }
  }

  #load() {
    try {
      const dir = this.#dataPath;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        return;
      }
      const recordsPath = join(dir, 'records.jsonl');
      if (existsSync(recordsPath)) {
        const lines = readFileSync(recordsPath, 'utf-8').trim().split('\n').filter(Boolean);
        this.#records = lines.map(l => JSON.parse(l));
      }
      const configPath = join(dir, 'config.json');
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        this.#budgets = config.budgets || {};
        this.#customPricing = config.customPricing || {};
      }
    } catch (e) {
      this.#records = [];
    }
  }

  #persist() {
    try {
      const dir = this.#dataPath;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      
      const recordsPath = join(dir, 'records.jsonl');
      const lines = this.#records.map(r => JSON.stringify(r)).join('\n');
      writeFileSync(recordsPath, lines + '\n', 'utf-8');
      
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({ budgets: this.#budgets, customPricing: this.#customPricing }, null, 2), 'utf-8');
    } catch (e) {
      this.emit('error', e);
    }
  }
}

export default CostTracker;

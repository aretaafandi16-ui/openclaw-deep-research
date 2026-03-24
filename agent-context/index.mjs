/**
 * agent-context v1.0.0
 * Zero-dependency context window manager for AI agents
 * 
 * Features:
 * - Approximate token counting (character + word boundary heuristic)
 * - Context window management with configurable max tokens
 * - Smart truncation: sliding_window, priority, summarize, hybrid
 * - Message roles with priority handling (system > tool > assistant > user)
 * - Context budgeting: allocate tokens to system/tools/conversation
 * - Compression: dedup, merge similar, strip whitespace
 * - Multi-model presets (GPT-4, Claude, Gemini, Llama, etc.)
 * - Context templates for common patterns
 * - Statistics & analytics
 * - JSONL persistence
 * - EventEmitter for real-time events
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Approximate token count. Uses a heuristic:
 * - ~4 chars per token for English (OpenAI's rule of thumb)
 * - Adjusts for whitespace-heavy content
 * - Handles CJK characters (~1.5 chars per token)
 * - Code gets ~3.5 chars per token
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  
  // Count CJK characters (each ~1-2 tokens)
  const cjk = (str.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu) || []).length;
  // Count code-like patterns (brackets, operators, etc.)
  const codePatterns = (str.match(/[{}[\]()=><!&|+\-*/]/g) || []).length;
  // Regular characters
  const regular = str.length - cjk - codePatterns;
  
  // Heuristic: regular=4chars/token, CJK=1.5chars/token, code=3chars/token
  return Math.ceil(regular / 4 + cjk / 1.5 + codePatterns / 3);
}

/**
 * Estimate tokens for a message object
 */
export function estimateMessageTokens(msg) {
  let tokens = 4; // overhead per message (role, formatting)
  if (msg.role) tokens += 2;
  if (msg.name) tokens += 2;
  if (typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') tokens += estimateTokens(part.text);
      else if (part.type === 'image_url') tokens += 85; // vision token estimate
      else tokens += estimateTokens(JSON.stringify(part));
    }
  }
  if (msg.tool_calls) tokens += estimateTokens(JSON.stringify(msg.tool_calls));
  if (msg.tool_call_id) tokens += 4;
  return tokens;
}

// ─── Model Presets ──────────────────────────────────────────────────────────

export const MODEL_PRESETS = {
  'gpt-4o':              { maxTokens: 128000,  reserveOutput: 16384 },
  'gpt-4-turbo':         { maxTokens: 128000,  reserveOutput: 4096 },
  'gpt-4':               { maxTokens: 8192,    reserveOutput: 4096 },
  'gpt-4-32k':           { maxTokens: 32768,   reserveOutput: 4096 },
  'gpt-3.5-turbo':       { maxTokens: 16385,   reserveOutput: 4096 },
  'gpt-3.5-turbo-16k':   { maxTokens: 16385,   reserveOutput: 4096 },
  'claude-3-opus':       { maxTokens: 200000,  reserveOutput: 4096 },
  'claude-3-sonnet':     { maxTokens: 200000,  reserveOutput: 4096 },
  'claude-3-haiku':      { maxTokens: 200000,  reserveOutput: 4096 },
  'claude-3.5-sonnet':   { maxTokens: 200000,  reserveOutput: 8192 },
  'gemini-pro':          { maxTokens: 32768,   reserveOutput: 8192 },
  'gemini-1.5-pro':      { maxTokens: 1000000, reserveOutput: 8192 },
  'gemini-1.5-flash':    { maxTokens: 1000000, reserveOutput: 8192 },
  'llama-3-70b':         { maxTokens: 8192,    reserveOutput: 4096 },
  'llama-3.1-70b':       { maxTokens: 131072,  reserveOutput: 4096 },
  'llama-3.1-405b':      { maxTokens: 131072,  reserveOutput: 4096 },
  'mistral-large':       { maxTokens: 128000,  reserveOutput: 4096 },
  'mixtral-8x7b':        { maxTokens: 32768,   reserveOutput: 4096 },
  'command-r-plus':      { maxTokens: 128000,  reserveOutput: 4096 },
};

// ─── Role Priorities ────────────────────────────────────────────────────────

const ROLE_PRIORITY = {
  system: 100,
  tool: 80,
  function: 80,
  assistant: 50,
  user: 30,
};

// ─── Context Manager ────────────────────────────────────────────────────────

export class ContextManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.maxTokens = opts.maxTokens != null ? opts.maxTokens : 128000;
    this.reserveOutput = opts.reserveOutput != null ? opts.reserveOutput : 4096;
    this.model = opts.model || null;
    this.messages = [];
    this.budgets = {
      system: opts.budgetSystem || null, // null = uncapped
      tools: opts.budgetTools || null,
      conversation: opts.budgetConversation || null,
    };
    this.stats = {
      totalAdded: 0,
      totalTruncated: 0,
      totalCompressed: 0,
      peakTokens: 0,
      currentTokens: 0,
    };
    this.persistencePath = opts.persistencePath || null;
    this._toolDefinitions = [];
    
    if (opts.model && MODEL_PRESETS[opts.model]) {
      const preset = MODEL_PRESETS[opts.model];
      this.maxTokens = preset.maxTokens;
      this.reserveOutput = preset.reserveOutput;
    }
    
    if (this.persistencePath) {
      if (!existsSync(this.persistencePath)) {
        mkdirSync(this.persistencePath, { recursive: true });
      }
      this._loadPersisted();
    }
  }

  // ─── Available Token Budget ─────────────────────────────────────────────

  get availableTokens() {
    return this.maxTokens - this.reserveOutput;
  }

  get inputTokens() {
    return this._countTokens(this.messages);
  }

  get remainingTokens() {
    return this.availableTokens - this.inputTokens - this._toolDefTokens;
  }

  get _toolDefTokens() {
    return this._countTokens(this._toolDefinitions.map(t => ({ role: 'tool_def', content: JSON.stringify(t) })));
  }

  get utilizationPercent() {
    return Math.round((this.inputTokens / this.availableTokens) * 10000) / 100;
  }

  // ─── Message Management ─────────────────────────────────────────────────

  /**
   * Add a message to the context
   */
  add(msg) {
    const message = {
      role: msg.role || 'user',
      content: msg.content || '',
      name: msg.name,
      tool_call_id: msg.tool_call_id,
      tool_calls: msg.tool_calls,
      _id: msg._id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      _tokens: 0,
      _priority: msg.priority ?? ROLE_PRIORITY[msg.role] ?? 50,
      _timestamp: msg._timestamp || Date.now(),
      _tags: msg._tags || [],
      _persistent: msg._persistent ?? false, // never auto-remove
    };
    message._tokens = estimateMessageTokens(message);
    
    this.messages.push(message);
    this.stats.totalAdded++;
    this.stats.currentTokens = this.inputTokens;
    if (this.stats.currentTokens > this.stats.peakTokens) {
      this.stats.peakTokens = this.stats.currentTokens;
    }
    
    this.emit('message:added', message);
    this._persist('add', message);
    return message;
  }

  /**
   * Add system message (always high priority)
   */
  addSystem(content, opts = {}) {
    return this.add({ role: 'system', content, priority: 100, _persistent: true, ...opts });
  }

  /**
   * Add user message
   */
  addUser(content, opts = {}) {
    return this.add({ role: 'user', content, ...opts });
  }

  /**
   * Add assistant message
   */
  addAssistant(content, opts = {}) {
    return this.add({ role: 'assistant', content, ...opts });
  }

  /**
   * Add tool result
   */
  addToolResult(toolCallId, content, opts = {}) {
    return this.add({ role: 'tool', content, tool_call_id: toolCallId, ...opts });
  }

  /**
   * Set tool definitions (counted against budget)
   */
  setToolDefinitions(tools) {
    this._toolDefinitions = tools || [];
    this.emit('tools:updated', this._toolDefinitions);
  }

  /**
   * Remove a message by ID
   */
  remove(messageId) {
    const idx = this.messages.findIndex(m => m._id === messageId);
    if (idx === -1) return false;
    const [removed] = this.messages.splice(idx, 1);
    this.stats.currentTokens = this.inputTokens;
    this.emit('message:removed', removed);
    this._persist('remove', { _id: messageId });
    return true;
  }

  /**
   * Clear all messages (optionally keep persistent ones)
   */
  clear(keepPersistent = true) {
    if (keepPersistent) {
      this.messages = this.messages.filter(m => m._persistent);
    } else {
      this.messages = [];
    }
    this.stats.currentTokens = this.inputTokens;
    this.emit('messages:cleared');
    this._persist('clear', { keepPersistent });
  }

  /**
   * Get messages for API call (auto-fits within budget)
   */
  getMessages(opts = {}) {
    const strategy = opts.strategy || 'hybrid';
    const maxInput = opts.maxTokens || this.availableTokens;
    let msgs = [...this.messages];
    
    // Always include tool definitions token count
    const toolTokens = this._toolDefTokens;
    const budget = maxInput - toolTokens;
    
    const currentTokens = this._countTokens(msgs);
    
    if (currentTokens <= budget) return msgs;
    
    // Need to truncate
    return this._truncate(msgs, budget, strategy);
  }

  /**
   * Get a specific section of messages
   */
  getRange(startIdx, endIdx) {
    return this.messages.slice(startIdx, endIdx);
  }

  /**
   * Get last N messages
   */
  last(n = 10) {
    return this.messages.slice(-n);
  }

  /**
   * Find messages by criteria
   */
  find(predicate) {
    if (typeof predicate === 'string') {
      return this.messages.filter(m => m.role === predicate);
    }
    if (typeof predicate === 'function') {
      return this.messages.filter(predicate);
    }
    return [];
  }

  // ─── Truncation Strategies ──────────────────────────────────────────────

  _truncate(messages, budget, strategy) {
    this.stats.totalTruncated++;
    
    switch (strategy) {
      case 'sliding_window':
        return this._slidingWindow(messages, budget);
      case 'priority':
        return this._priorityTruncate(messages, budget);
      case 'summarize':
        return this._summarizeTruncate(messages, budget);
      case 'hybrid':
      default:
        return this._hybridTruncate(messages, budget);
    }
  }

  /**
   * Sliding window: keep system + last N messages that fit
   */
  _slidingWindow(messages, budget) {
    const system = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    
    let result = [...system];
    let tokens = this._countTokens(result);
    
    // Add from the end
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msgTokens = nonSystem[i]._tokens;
      if (tokens + msgTokens <= budget) {
        result.splice(system.length, 0, nonSystem[i]);
        tokens += msgTokens;
      } else {
        break;
      }
    }
    
    this.emit('truncated', { strategy: 'sliding_window', original: messages.length, result: result.length, dropped: messages.length - result.length });
    return result;
  }

  /**
   * Priority-based: keep highest priority messages
   */
  _priorityTruncate(messages, budget) {
    // Sort by priority (descending), then recency
    const sorted = [...messages].sort((a, b) => {
      if (a._priority !== b._priority) return b._priority - a._priority;
      return b._timestamp - a._timestamp;
    });
    
    let result = [];
    let tokens = 0;
    
    for (const msg of sorted) {
      if (msg._persistent || tokens + msg._tokens <= budget) {
        result.push(msg);
        tokens += msg._tokens;
      }
    }
    
    // Restore chronological order
    result.sort((a, b) => a._timestamp - b._timestamp);
    
    this.emit('truncated', { strategy: 'priority', original: messages.length, result: result.length, dropped: messages.length - result.length });
    return result;
  }

  /**
   * Summarize: create a summary of dropped messages, keep recent
   */
  _summarizeTruncate(messages, budget) {
    const system = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    
    // Reserve space for summary
    const summaryReserve = Math.floor(budget * 0.15);
    const remainingBudget = budget - summaryReserve;
    
    // Keep recent messages that fit
    let recent = [];
    let tokens = this._countTokens(system);
    
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      if (tokens + nonSystem[i]._tokens <= remainingBudget) {
        recent.unshift(nonSystem[i]);
        tokens += nonSystem[i]._tokens;
      } else {
        break;
      }
    }
    
    const dropped = nonSystem.slice(0, nonSystem.length - recent.length);
    
    // Create summary placeholder
    if (dropped.length > 0) {
      const summary = {
        role: 'system',
        content: `[Context Summary] ${dropped.length} earlier messages truncated. Topics: ${this._extractTopics(dropped).join(', ')}. Message roles: ${dropped.map(m => m.role).join(', ')}.`,
        _id: `summary_${Date.now()}`,
        _tokens: 0,
        _priority: 95,
        _timestamp: Date.now(),
        _persistent: false,
        _isSummary: true,
      };
      summary._tokens = estimateMessageTokens(summary);
      
      const result = [...system, summary, ...recent];
      this.emit('truncated', { strategy: 'summarize', original: messages.length, result: result.length, dropped: dropped.length, summarized: true });
      return result;
    }
    
    return [...system, ...recent];
  }

  /**
   * Hybrid: system first, then best of priority + recency
   */
  _hybridTruncate(messages, budget) {
    const system = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    
    let result = [...system];
    let tokens = this._countTokens(result);
    const available = budget - tokens;
    
    // Split: 60% recent, 40% high-priority (tool results, important messages)
    const recentBudget = Math.floor(available * 0.6);
    const priorityBudget = available - recentBudget;
    
    // Collect recent messages (from end)
    const recent = [];
    let recentTokens = 0;
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      if (recentTokens + nonSystem[i]._tokens <= recentBudget) {
        recent.unshift(nonSystem[i]);
        recentTokens += nonSystem[i]._tokens;
      } else {
        break;
      }
    }
    
    // Collect high-priority messages not already in recent
    const recentIds = new Set(recent.map(m => m._id));
    const priority = [];
    let priorityTokens = 0;
    const sortedByPriority = [...nonSystem]
      .filter(m => !recentIds.has(m._id))
      .sort((a, b) => b._priority - a._priority);
    
    for (const msg of sortedByPriority) {
      if (msg._persistent || priorityTokens + msg._tokens <= priorityBudget) {
        priority.push(msg);
        priorityTokens += msg._tokens;
      }
    }
    
    // Merge and sort chronologically
    const merged = [...recent, ...priority].sort((a, b) => a._timestamp - b._timestamp);
    result = [...system, ...merged];
    
    this.emit('truncated', { strategy: 'hybrid', original: messages.length, result: result.length, dropped: messages.length - result.length });
    return result;
  }

  // ─── Compression ─────────────────────────────────────────────────────────

  /**
   * Compress context: deduplicate, merge similar, strip whitespace
   */
  compress(opts = {}) {
    let msgs = [...this.messages];
    const before = this._countTokens(msgs);
    
    // 1. Strip excessive whitespace
    if (opts.stripWhitespace !== false) {
      msgs = msgs.map(m => ({
        ...m,
        content: typeof m.content === 'string' 
          ? m.content.replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
          : m.content,
      }));
    }
    
    // 2. Deduplicate consecutive identical messages
    if (opts.deduplicate !== false) {
      const deduped = [];
      for (const msg of msgs) {
        const last = deduped[deduped.length - 1];
        if (last && last.role === msg.role && last.content === msg.content) {
          continue; // skip duplicate
        }
        deduped.push(msg);
      }
      msgs = deduped;
    }
    
    // 3. Merge consecutive user messages (or assistant messages)
    if (opts.mergeConsecutive) {
      const merged = [];
      for (const msg of msgs) {
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role && last.role !== 'tool' && last.role !== 'system' && !last.tool_calls && !msg.tool_calls) {
          last.content = `${last.content}\n\n${msg.content}`;
          last._tokens = estimateMessageTokens(last);
        } else {
          merged.push({ ...msg });
        }
      }
      msgs = merged;
    }
    
    // Recalculate tokens
    msgs.forEach(m => { m._tokens = estimateMessageTokens(m); });
    
    const after = this._countTokens(msgs);
    this.messages = msgs;
    this.stats.totalCompressed++;
    this.stats.currentTokens = this.inputTokens;
    
    const result = { before, after, saved: before - after, ratio: Math.round((1 - after / before) * 10000) / 100 };
    this.emit('compressed', result);
    return result;
  }

  // ─── Context Budgeting ───────────────────────────────────────────────────

  /**
   * Set token budgets per section
   */
  setBudgets(budgets) {
    Object.assign(this.budgets, budgets);
    this.emit('budgets:updated', this.budgets);
  }

  /**
   * Get budget allocation breakdown
   */
  getBudgetBreakdown() {
    const systemMsgs = this.messages.filter(m => m.role === 'system');
    const toolMsgs = this.messages.filter(m => m.role === 'tool' || m.role === 'function');
    const convMsgs = this.messages.filter(m => m.role !== 'system' && m.role !== 'tool' && m.role !== 'function');
    
    const systemTokens = this._countTokens(systemMsgs);
    const toolTokens = this._countTokens(toolMsgs) + this._toolDefTokens;
    const convTokens = this._countTokens(convMsgs);
    
    return {
      system: { used: systemTokens, budget: this.budgets.system, over: this.budgets.system ? systemTokens > this.budgets.system : false },
      tools: { used: toolTokens, budget: this.budgets.tools, over: this.budgets.tools ? toolTokens > this.budgets.tools : false },
      conversation: { used: convTokens, budget: this.budgets.conversation, over: this.budgets.conversation ? convTokens > this.budgets.conversation : false },
      total: { used: systemTokens + toolTokens + convTokens, available: this.availableTokens },
    };
  }

  /**
   * Enforce budgets — truncate conversation section to fit
   */
  enforceBudgets() {
    const breakdown = this.getBudgetBreakdown();
    
    if (this.budgets.conversation && breakdown.conversation.used > this.budgets.conversation) {
      const convMsgs = this.messages.filter(m => m.role !== 'system' && m.role !== 'tool' && m.role !== 'function');
      const truncated = this._slidingWindow(convMsgs, this.budgets.conversation);
      const truncatedIds = new Set(truncated.map(m => m._id));
      
      this.messages = this.messages.filter(m => 
        m.role === 'system' || m.role === 'tool' || m.role === 'function' || truncatedIds.has(m._id)
      );
      this.stats.currentTokens = this.inputTokens;
      this.emit('budget:enforced', { section: 'conversation', truncated: convMsgs.length - truncated.length });
    }
    
    return this.getBudgetBreakdown();
  }

  // ─── Statistics ──────────────────────────────────────────────────────────

  getStats() {
    const breakdown = this.getBudgetBreakdown();
    const roleCounts = {};
    const roleTokens = {};
    
    for (const msg of this.messages) {
      roleCounts[msg.role] = (roleCounts[msg.role] || 0) + 1;
      roleTokens[msg.role] = (roleTokens[msg.role] || 0) + msg._tokens;
    }
    
    return {
      ...this.stats,
      currentTokens: this.inputTokens,
      maxTokens: this.maxTokens,
      availableTokens: this.availableTokens,
      reserveOutput: this.reserveOutput,
      remainingTokens: this.remainingTokens,
      utilizationPercent: this.utilizationPercent,
      messageCount: this.messages.length,
      roleCounts,
      roleTokens,
      budget: breakdown,
      toolDefinitions: this._toolDefinitions.length,
      model: this.model,
    };
  }

  /**
   * Get detailed token breakdown per message
   */
  getTokenBreakdown() {
    return this.messages.map(m => ({
      id: m._id,
      role: m.role,
      tokens: m._tokens,
      preview: typeof m.content === 'string' ? m.content.slice(0, 80) : '[non-string]',
      priority: m._priority,
      persistent: m._persistent,
    }));
  }

  // ─── Templates ───────────────────────────────────────────────────────────

  /**
   * Apply a context template
   */
  applyTemplate(template, vars = {}) {
    const templates = {
      'chat': [
        { role: 'system', content: 'You are a helpful assistant.' },
      ],
      'coding': [
        { role: 'system', content: 'You are an expert programmer. Write clean, efficient, well-documented code.' },
      ],
      'analysis': [
        { role: 'system', content: 'You are a data analyst. Provide thorough analysis with evidence.' },
      ],
      'creative': [
        { role: 'system', content: 'You are a creative writer. Be imaginative and engaging.' },
      ],
      'agent': [
        { role: 'system', content: vars.systemPrompt || 'You are an autonomous AI agent. Think step by step, use tools when needed, and report results clearly.' },
      ],
      'summarizer': [
        { role: 'system', content: 'You are a summarizer. Distill information into concise, accurate summaries.' },
      ],
    };
    
    const msgs = templates[template];
    if (!msgs) throw new Error(`Unknown template: ${template}. Available: ${Object.keys(templates).join(', ')}`);
    
    for (const msg of msgs) {
      const content = msg.content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
      this.addSystem(content);
    }
    
    this.emit('template:applied', { template, vars });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _countTokens(messages) {
    return messages.reduce((sum, m) => sum + (m._tokens || estimateMessageTokens(m)), 0);
  }

  _extractTopics(messages) {
    const words = messages
      .filter(m => typeof m.content === 'string')
      .map(m => m.content)
      .join(' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4);
    
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  _persist(action, data) {
    if (!this.persistencePath) return;
    const file = join(this.persistencePath, 'context.jsonl');
    const entry = JSON.stringify({ action, data, timestamp: Date.now() });
    appendFileSync(file, entry + '\n');
  }

  _loadPersisted() {
    if (!this.persistencePath) return;
    const file = join(this.persistencePath, 'context.jsonl');
    if (!existsSync(file)) return;
    
    try {
      const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const { action, data } = JSON.parse(line);
        if (action === 'add') {
          this.messages.push({ ...data, _tokens: data._tokens || estimateMessageTokens(data) });
        } else if (action === 'remove') {
          this.messages = this.messages.filter(m => m._id !== data._id);
        } else if (action === 'clear') {
          if (data.keepPersistent) {
            this.messages = this.messages.filter(m => m._persistent);
          } else {
            this.messages = [];
          }
        }
      }
      this.stats.currentTokens = this.inputTokens;
    } catch {
      // corrupt file, start fresh
    }
  }

  /**
   * Export context as JSON
   */
  export() {
    return {
      messages: this.messages,
      stats: this.getStats(),
      budgets: this.budgets,
      model: this.model,
      maxTokens: this.maxTokens,
      reserveOutput: this.reserveOutput,
    };
  }

  /**
   * Import context from JSON
   */
  import(data) {
    if (data.messages) {
      this.messages = data.messages.map(m => ({
        ...m,
        _tokens: m._tokens || estimateMessageTokens(m),
      }));
    }
    if (data.budgets) this.budgets = data.budgets;
    if (data.model) this.model = data.model;
    if (data.maxTokens) this.maxTokens = data.maxTokens;
    if (data.reserveOutput) this.reserveOutput = data.reserveOutput;
    this.stats.currentTokens = this.inputTokens;
    this.emit('imported');
  }

  /**
   * Clone this context manager
   */
  clone() {
    const ctx = new ContextManager({
      maxTokens: this.maxTokens,
      reserveOutput: this.reserveOutput,
      model: this.model,
      ...this.budgets,
    });
    ctx.messages = this.messages.map(m => ({ ...m }));
    ctx._toolDefinitions = [...this._toolDefinitions];
    return ctx;
  }
}

// ─── Convenience Factory ────────────────────────────────────────────────────

export function createContext(opts) {
  return new ContextManager(opts);
}

export function createContextForModel(modelName, opts = {}) {
  const preset = MODEL_PRESETS[modelName];
  if (!preset) throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(MODEL_PRESETS).join(', ')}`);
  return new ContextManager({ model: modelName, ...preset, ...opts });
}

export default { ContextManager, estimateTokens, estimateMessageTokens, MODEL_PRESETS, createContext, createContextForModel };

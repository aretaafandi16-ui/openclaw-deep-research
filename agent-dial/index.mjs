#!/usr/bin/env node
// agent-dial — zero-dep dialog & conversation state machine for AI agents
// DialogEngine: multi-turn conversations with branching, slot filling, intent routing

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Slot Validators ────────────────────────────────────────────────────────────
const SlotValidators = {
  required: (v) => (v != null && v !== '' ? null : 'This field is required'),
  string: (v) => (typeof v === 'string' ? null : 'Must be a string'),
  number: (v) => (typeof v === 'number' || !isNaN(Number(v)) ? null : 'Must be a number'),
  integer: (v) => (Number.isInteger(Number(v)) && !isNaN(Number(v)) ? null : 'Must be an integer'),
  boolean: (v) => (typeof v === 'boolean' || ['true','false','yes','no'].includes(String(v).toLowerCase()) ? null : 'Must be true/false'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Must be a valid email'),
  phone: (v) => (/^[\d\s\-+()]{7,}$/.test(v) ? null : 'Must be a valid phone number'),
  url: (v) => (/^https?:\/\/.+/.test(v) ? null : 'Must be a valid URL'),
  min: (v, min) => (String(v).length >= min ? null : `Must be at least ${min} characters`),
  max: (v, max) => (String(v).length <= max ? null : `Must be at most ${max} characters`),
  pattern: (v, re) => (new RegExp(re).test(v) ? null : `Must match pattern ${re}`),
  enum: (v, opts) => (opts.includes(v) ? null : `Must be one of: ${opts.join(', ')}`),
  range: (v, lo, hi) => { const n = Number(v); return (!isNaN(n) && n >= lo && n <= hi ? null : `Must be between ${lo} and ${hi}`); },
};

// ─── DialogSlot ──────────────────────────────────────────────────────────────────
class DialogSlot {
  constructor(def = {}) {
    this.name = def.name || 'unnamed';
    this.type = def.type || 'string';
    this.prompt = def.prompt || `Please provide ${this.name}:`;
    this.reprompt = def.reprompt || null;
    this.default = def.default ?? null;
    this.required = def.required !== false;
    this.validate = def.validate || []; // array of [validatorName, ...args]
    this.transform = def.transform || null; // 'lowercase'|'trim'|'number'|'boolean'|custom fn
    this.parser = def.parser || null; // custom extraction function
    this.value = undefined;
    this.filled = false;
    this.attempts = 0;
    this.maxAttempts = def.maxAttempts || 5;
  }

  fill(rawValue) {
    let value = rawValue;
    // Transform
    if (this.transform) {
      if (typeof this.transform === 'function') {
        value = this.transform(value);
      } else if (this.transform === 'lowercase') {
        value = String(value).toLowerCase();
      } else if (this.transform === 'uppercase') {
        value = String(value).toUpperCase();
      } else if (this.transform === 'trim') {
        value = String(value).trim();
      } else if (this.transform === 'number') {
        value = Number(value);
      } else if (this.transform === 'boolean') {
        value = ['true','yes','1'].includes(String(value).toLowerCase());
      } else if (this.transform === 'integer') {
        value = parseInt(value, 10);
      }
    }
    // Validate
    const errors = this._validate(value);
    if (errors.length > 0) {
      this.attempts++;
      return { ok: false, errors, attempts: this.attempts, maxAttempts: this.maxAttempts };
    }
    this.value = value;
    this.filled = true;
    return { ok: true, value };
  }

  _validate(value) {
    const errors = [];
    if (this.required && (value == null || value === '')) {
      errors.push('This field is required');
      return errors;
    }
    if (!this.required && (value == null || value === '')) return errors;
    // Type check
    const typeValidator = SlotValidators[this.type];
    if (typeValidator && this.type !== 'string') {
      const err = typeValidator(value);
      if (err) errors.push(err);
    }
    // Custom validators
    for (const v of this.validate) {
      const name = typeof v === 'string' ? v : v[0];
      const args = Array.isArray(v) ? v.slice(1) : [];
      const fn = SlotValidators[name];
      if (fn) {
        const err = fn(value, ...args);
        if (err) errors.push(err);
      }
    }
    return errors;
  }

  toJSON() {
    return { name: this.name, type: this.type, prompt: this.prompt, required: this.required, filled: this.filled, value: this.value, attempts: this.attempts };
  }
}

// ─── DialogTurn ──────────────────────────────────────────────────────────────────
class DialogTurn {
  constructor(role, content, timestamp = Date.now(), metadata = {}) {
    this.id = randomUUID().slice(0, 8);
    this.role = role; // 'user' | 'system' | 'agent'
    this.content = content;
    this.timestamp = timestamp;
    this.metadata = metadata;
  }

  toJSON() {
    return { id: this.id, role: this.role, content: this.content, timestamp: this.timestamp, metadata: this.metadata };
  }
}

// ─── DialogSession ───────────────────────────────────────────────────────────────
class DialogSession {
  constructor(id, flowId, state = {}) {
    this.id = id || randomUUID();
    this.flowId = flowId;
    this.state = state; // arbitrary user state
    this.slots = {}; // slot name → DialogSlot instance
    this.turns = []; // conversation history
    this.currentNode = null;
    this.visitedNodes = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.completedAt = null;
    this.active = true;
    this.intent = null;
    this.metadata = {};
  }

  addTurn(role, content, metadata = {}) {
    const turn = new DialogTurn(role, content, Date.now(), metadata);
    this.turns.push(turn);
    this.updatedAt = Date.now();
    return turn;
  }

  getSlotValues() {
    const result = {};
    for (const [name, slot] of Object.entries(this.slots)) {
      if (slot.filled) result[name] = slot.value;
    }
    return result;
  }

  toJSON() {
    return {
      id: this.id, flowId: this.flowId, state: this.state,
      slots: Object.fromEntries(Object.entries(this.slots).map(([k, v]) => [k, v.toJSON()])),
      turns: this.turns.map(t => t.toJSON()),
      currentNode: this.currentNode, visitedNodes: this.visitedNodes,
      createdAt: this.createdAt, updatedAt: this.updatedAt, completedAt: this.completedAt,
      active: this.active, intent: this.intent, metadata: this.metadata,
    };
  }
}

// ─── IntentMatcher ───────────────────────────────────────────────────────────────
function matchIntent(input, patterns) {
  const text = String(input).toLowerCase().trim();
  for (const p of patterns) {
    if (p.exact && text === p.exact.toLowerCase()) return p;
    if (p.contains && text.includes(p.contains.toLowerCase())) return p;
    if (p.regex && new RegExp(p.regex, 'i').test(text)) return p;
    if (p.startsWith && text.startsWith(p.startsWith.toLowerCase())) return p;
    if (p.keywords && p.keywords.some(k => text.includes(k.toLowerCase()))) return p;
    if (typeof p.fn === 'function' && p.fn(text)) return p;
  }
  return null;
}

// ─── DialogEngine ────────────────────────────────────────────────────────────────
class DialogEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.flows = new Map(); // flowId → flow definition
    this.sessions = new Map(); // sessionId → DialogSession
    this.globalIntents = []; // global intent matchers
    this.maxSessions = opts.maxSessions || 1000;
    this.persistPath = opts.persistPath || null;
    this.snapshotInterval = opts.snapshotInterval || 0;
    this._snapshotTimer = null;

    if (this.persistPath) {
      this._loadPersisted();
      if (this.snapshotInterval > 0) {
        this._snapshotTimer = setInterval(() => this.save(), this.snapshotInterval);
      }
    }
  }

  // ── Flow Registration ────────────────────────────────────────────────────────
  defineFlow(flowId, definition) {
    const flow = {
      id: flowId,
      name: definition.name || flowId,
      startNode: definition.startNode || 'start',
      nodes: new Map(),
      globalSlots: definition.globalSlots || [],
      onComplete: definition.onComplete || null,
      metadata: definition.metadata || {},
    };

    // Register nodes
    for (const [nodeId, nodeDef] of Object.entries(definition.nodes || {})) {
      flow.nodes.set(nodeId, {
        id: nodeId,
        type: nodeDef.type || 'message', // message|slot_fill|branch|intent_router|action|end
        content: nodeDef.content || null,
        slots: (nodeDef.slots || []).map(s => new DialogSlot(s)),
        transitions: nodeDef.transitions || [], // [{when, goto}]
        intents: nodeDef.intents || [], // intent patterns for routing
        action: nodeDef.action || null, // async function(ctx) => result
        handler: nodeDef.handler || null, // custom handler fn(session, input, engine) => response
        metadata: nodeDef.metadata || {},
      });
    }

    this.flows.set(flowId, flow);
    this.emit('flow:defined', flowId);
    return this;
  }

  // ── Session Management ───────────────────────────────────────────────────────
  createSession(flowId, sessionId = null, initialState = {}) {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error(`Flow "${flowId}" not found`);

    // Evict old sessions if over limit
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) { this.sessions.delete(oldest.id); this.emit('session:evicted', oldest.id); }
    }

    const session = new DialogSession(sessionId, flowId, initialState);
    // Initialize global slots
    for (const slotDef of flow.globalSlots) {
      session.slots[slotDef.name] = new DialogSlot(slotDef);
    }
    session.currentNode = flow.startNode;
    session.visitedNodes.push(flow.startNode);

    this.sessions.set(session.id, session);
    this.emit('session:created', session.id, flowId);
    this._persist('session:created', session.toJSON());
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.active = false;
    session.completedAt = Date.now();
    this.emit('session:ended', sessionId);
    this._persist('session:ended', session.toJSON());
    return true;
  }

  // ── Message Processing ───────────────────────────────────────────────────────
  async processMessage(sessionId, userInput) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    if (!session.active) return { response: 'This conversation has ended.', ended: true };

    const flow = this.flows.get(session.flowId);
    if (!flow) throw new Error(`Flow "${session.flowId}" not found`);

    // Record user turn
    session.addTurn('user', userInput);
    this.emit('message:received', sessionId, userInput);

    // Process through current node
    const result = await this._processNode(session, flow, userInput);

    // Record agent turn
    if (result.response) {
      session.addTurn('agent', result.response, { node: session.currentNode, ...result.metadata });
    }

    session.updatedAt = Date.now();
    this.emit('message:processed', sessionId, result);
    this._persist('message', { sessionId, userInput, result });

    // Auto-save
    if (this.persistPath) this.save();

    return result;
  }

  async _processNode(session, flow, input) {
    const node = flow.nodes.get(session.currentNode);
    if (!node) return { response: `Unknown node: ${session.currentNode}`, error: true };

    switch (node.type) {
      case 'message':
        return this._handleMessage(session, flow, node, input);
      case 'slot_fill':
        return this._handleSlotFill(session, flow, node, input);
      case 'branch':
        return this._handleBranch(session, flow, node, input);
      case 'intent_router':
        return this._handleIntentRouter(session, flow, node, input);
      case 'action':
        return this._handleAction(session, flow, node, input);
      case 'end':
        return this._handleEnd(session, flow, node, input);
      default:
        return { response: node.content || `[node:${node.id}]`, node: node.id };
    }
  }

  async _handleMessage(session, flow, node, input) {
    const content = typeof node.content === 'function' ? await node.content(session, input) : node.content;
    // Auto-advance if transition exists
    if (node.transitions.length > 0) {
      const next = this._resolveTransition(session, flow, node, input);
      if (next) {
        session.currentNode = next;
        session.visitedNodes.push(next);
        return { response: content, nextNode: next, node: node.id };
      }
    }
    return { response: content, node: node.id };
  }

  async _handleSlotFill(session, flow, node, input) {
    // Fill slots from node definition
    const nodeSlots = node.slots;
    const errors = [];

    for (const slot of nodeSlots) {
      if (slot.filled) continue;
      // Try to extract value from input
      let rawValue = input;
      if (slot.parser) {
        rawValue = slot.parser(input, session);
      }
      const result = slot.fill(rawValue);
      if (result.ok) {
        session.slots[slot.name] = slot;
        this.emit('slot:filled', session.id, slot.name, slot.value);
      } else {
        errors.push({ slot: slot.name, errors: result.errors, attempts: result.attempts });
      }
    }

    // Check if all slots filled
    const unfilled = nodeSlots.filter(s => !s.filled);
    if (unfilled.length === 0) {
      // All slots filled, advance
      const next = this._resolveTransition(session, flow, node, input);
      if (next) {
        session.currentNode = next;
        session.visitedNodes.push(next);
        const nextNode = flow.nodes.get(next);
        const nextContent = nextNode?.content ? (typeof nextNode.content === 'function' ? await nextNode.content(session, input) : nextNode.content) : null;
        return { response: nextContent, slotsFilled: true, nextNode: next, node: node.id };
      }
      return { response: 'All information collected!', slotsFilled: true, node: node.id };
    }

    // Ask for next unfilled slot
    const nextSlot = unfilled[0];
    let prompt = nextSlot.prompt;
    if (errors.length > 0 && errors[0].slot === nextSlot.name) {
      prompt = nextSlot.reprompt || `Invalid input. ${errors[0].errors.join('. ')}. ${nextSlot.prompt}`;
    }
    return { response: prompt, slotRequired: nextSlot.name, errors, node: node.id };
  }

  async _handleBranch(session, flow, node, input) {
    for (const trans of node.transitions) {
      if (this._evalCondition(session, trans, input)) {
        session.currentNode = trans.goto;
        session.visitedNodes.push(trans.goto);
        const nextNode = flow.nodes.get(trans.goto);
        const nextContent = nextNode?.content ? (typeof nextNode.content === 'function' ? await nextNode.content(session, input) : nextNode.content) : null;
        return { response: nextContent, nextNode: trans.goto, node: node.id };
      }
    }
    // No branch matched
    return { response: node.content || 'No matching branch.', node: node.id };
  }

  async _handleIntentRouter(session, flow, node, input) {
    const matched = matchIntent(input, node.intents);
    if (matched) {
      session.intent = matched.intent || matched.id || 'matched';
      this.emit('intent:matched', session.id, session.intent, matched);
      const goto = matched.goto || matched.next;
      if (goto) {
        session.currentNode = goto;
        session.visitedNodes.push(goto);
        const nextNode = flow.nodes.get(goto);
        const nextContent = nextNode?.content ? (typeof nextNode.content === 'function' ? await nextNode.content(session, input) : nextNode.content) : null;
        return { response: nextContent, intent: session.intent, nextNode: goto, node: node.id };
      }
    }
    // Check global intents
    const globalMatch = matchIntent(input, this.globalIntents);
    if (globalMatch) {
      session.intent = globalMatch.intent || 'global_match';
      if (globalMatch.goto) {
        session.currentNode = globalMatch.goto;
        session.visitedNodes.push(globalMatch.goto);
      }
      return { response: globalMatch.response || `Intent: ${session.intent}`, intent: session.intent, node: node.id };
    }
    return { response: node.content || "I didn't understand that. Could you rephrase?", node: node.id };
  }

  async _handleAction(session, flow, node, input) {
    let actionResult = null;
    if (typeof node.action === 'function') {
      actionResult = await node.action({ session, input, slots: session.getSlotValues(), state: session.state });
    }
    if (typeof node.handler === 'function') {
      const handlerResult = await node.handler(session, input, this);
      if (handlerResult && typeof handlerResult === 'object') {
        Object.assign(session.state, handlerResult.state || {});
        actionResult = handlerResult;
      }
    }
    const next = this._resolveTransition(session, flow, node, input);
    if (next) {
      session.currentNode = next;
      session.visitedNodes.push(next);
      const nextNode = flow.nodes.get(next);
      const nextContent = nextNode?.content ? (typeof nextNode.content === 'function' ? await nextNode.content(session, input) : nextNode.content) : null;
      return { response: nextContent || actionResult?.response, actionResult, nextNode: next, node: node.id };
    }
    return { response: actionResult?.response || node.content || 'Action completed.', actionResult, node: node.id };
  }

  async _handleEnd(session, flow, node, input) {
    session.active = false;
    session.completedAt = Date.now();
    const content = typeof node.content === 'function' ? await node.content(session, input) : node.content || 'Conversation ended.';
    if (typeof flow.onComplete === 'function') {
      await flow.onComplete(session, this);
    }
    this.emit('session:completed', session.id, session.getSlotValues());
    return { response: content, ended: true, node: node.id };
  }

  _resolveTransition(session, flow, node, input) {
    for (const trans of node.transitions) {
      if (!trans.when) return trans.goto; // unconditional
      if (this._evalCondition(session, trans, input)) return trans.goto;
    }
    return null;
  }

  _evalCondition(session, trans, input) {
    const cond = trans.when;
    if (!cond) return true;
    if (typeof cond === 'function') return cond(session, input);
    if (cond.slotFilled) return session.slots[cond.slotFilled]?.filled === true;
    if (cond.slotEquals) return session.slots[cond.slotEquals[0]]?.value === cond.slotEquals[1];
    if (cond.stateEquals) return session.state[cond.stateEquals[0]] === cond.stateEquals[1];
    if (cond.inputContains) return String(input).toLowerCase().includes(cond.inputContains.toLowerCase());
    if (cond.inputRegex) return new RegExp(cond.inputRegex, 'i').test(input);
    if (cond.intent) return session.intent === cond.intent;
    if (cond.always) return true;
    return false;
  }

  // ── Global Intents ────────────────────────────────────────────────────────────
  addGlobalIntent(pattern) {
    this.globalIntents.push(pattern);
    return this;
  }

  // ── Context Helpers ───────────────────────────────────────────────────────────
  setSlotValue(sessionId, slotName, value) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    let slot = session.slots[slotName];
    if (!slot) {
      slot = new DialogSlot({ name: slotName });
      session.slots[slotName] = slot;
    }
    return slot.fill(value);
  }

  getSessionContext(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    return {
      id: session.id, flowId: session.flowId, active: session.active,
      currentNode: session.currentNode, slots: session.getSlotValues(),
      state: session.state, intent: session.intent,
      turnCount: session.turns.length, visitedNodes: session.visitedNodes,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
    };
  }

  getConversationHistory(sessionId, limit = 20) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    return session.turns.slice(-limit).map(t => t.toJSON());
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  stats() {
    const sessions = [...this.sessions.values()];
    return {
      flows: this.flows.size,
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.active).length,
      completedSessions: sessions.filter(s => s.completedAt).length,
      totalTurns: sessions.reduce((sum, s) => sum + s.turns.length, 0),
      avgTurnsPerSession: sessions.length > 0 ? +(sessions.reduce((sum, s) => sum + s.turns.length, 0) / sessions.length).toFixed(1) : 0,
    };
  }

  // ── Persistence ───────────────────────────────────────────────────────────────
  save() {
    if (!this.persistPath) return;
    const data = {
      sessions: Object.fromEntries([...this.sessions.entries()].map(([k, v]) => [k, v.toJSON()])),
      flows: Object.fromEntries([...this.flows.entries()].map(([k, v]) => [k, { ...v, nodes: Object.fromEntries(v.nodes) }])),
      timestamp: Date.now(),
    };
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }

  _loadPersisted() {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      // Restore sessions
      for (const [id, s] of Object.entries(data.sessions || {})) {
        const session = new DialogSession(s.id, s.flowId, s.state);
        Object.assign(session, s);
        session.slots = {};
        for (const [sn, sd] of Object.entries(s.slots || {})) {
          const slot = new DialogSlot(sd);
          Object.assign(slot, sd);
          session.slots[sn] = slot;
        }
        session.turns = (s.turns || []).map(t => new DialogTurn(t.role, t.content, t.timestamp, t.metadata));
        this.sessions.set(id, session);
      }
    } catch (e) { /* ignore corrupted */ }
  }

  _persist(event, data) {
    if (!this.persistPath) return;
    const logPath = this.persistPath + '.events.jsonl';
    const dir = dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify({ event, data, ts: Date.now() }) + '\n');
  }

  destroy() {
    if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    this.save();
  }
}

export { DialogEngine, DialogSession, DialogSlot, DialogTurn, matchIntent, SlotValidators };

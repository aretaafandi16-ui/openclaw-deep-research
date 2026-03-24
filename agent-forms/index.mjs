// agent-forms/index.mjs — Zero-dep form & survey engine for AI agents
// Schema validation, conditional logic, multi-step wizards, response collection

import { EventEmitter } from 'node:events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Field Types ────────────────────────────────────────────────────────────
const FIELD_TYPES = ['text', 'number', 'email', 'phone', 'url', 'password', 'textarea',
  'select', 'multiselect', 'radio', 'checkbox', 'boolean', 'date', 'time', 'datetime',
  'file', 'rating', 'slider', 'color', 'hidden', 'computed'];

// ─── Built-in Validators ────────────────────────────────────────────────────
const validators = {
  required: (val, _param, field) => {
    if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0))
      return `${field.label || field.name} is required`;
    return null;
  },
  min: (val, param, field) => {
    if (val === undefined || val === null) return null;
    if (typeof val === 'number' && val < param) return `${field.label || field.name} must be at least ${param}`;
    if (typeof val === 'string' && val.length < param) return `${field.label || field.name} must be at least ${param} characters`;
    return null;
  },
  max: (val, param, field) => {
    if (val === undefined || val === null) return null;
    if (typeof val === 'number' && val > param) return `${field.label || field.name} must be at most ${param}`;
    if (typeof val === 'string' && val.length > param) return `${field.label || field.name} must be at most ${param} characters`;
    return null;
  },
  pattern: (val, param, field) => {
    if (val === undefined || val === null || val === '') return null;
    const re = new RegExp(param);
    if (!re.test(String(val))) return `${field.label || field.name} format is invalid`;
    return null;
  },
  enum: (val, param, field) => {
    if (val === undefined || val === null) return null;
    if (Array.isArray(val)) {
      for (const v of val) {
        if (!param.includes(v)) return `${field.label || field.name} contains invalid value: ${v}`;
      }
      return null;
    }
    if (!param.includes(val)) return `${field.label || field.name} must be one of: ${param.join(', ')}`;
    return null;
  },
  custom: (val, param, _field) => {
    if (typeof param === 'function') return param(val);
    return null;
  },
  email: (val, _param, field) => {
    if (!val) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) return `${field.label || field.name} must be a valid email`;
    return null;
  },
  url: (val, _param, field) => {
    if (!val) return null;
    try { new URL(String(val)); } catch { return `${field.label || field.name} must be a valid URL`; }
    return null;
  },
  phone: (val, _param, field) => {
    if (!val) return null;
    if (!/^[\+]?[\d\s\-\(\)]{7,20}$/.test(String(val))) return `${field.label || field.name} must be a valid phone number`;
    return null;
  },
  minItems: (val, param, field) => {
    if (!Array.isArray(val)) return null;
    if (val.length < param) return `${field.label || field.name} must have at least ${param} items`;
    return null;
  },
  maxItems: (val, param, field) => {
    if (!Array.isArray(val)) return null;
    if (val.length > param) return `${field.label || field.name} must have at most ${param} items`;
    return null;
  },
  minLength: (val, param, field) => {
    if (!val) return null;
    if (String(val).length < param) return `${field.label || field.name} must be at least ${param} characters`;
    return null;
  },
  maxLength: (val, param, field) => {
    if (!val) return null;
    if (String(val).length > param) return `${field.label || field.name} must be at most ${param} characters`;
    return null;
  },
};

// ─── Form Field ─────────────────────────────────────────────────────────────
class FormField {
  constructor(def) {
    this.name = def.name;
    this.type = def.type || 'text';
    this.label = def.label || def.name;
    this.placeholder = def.placeholder || '';
    this.description = def.description || '';
    this.defaultValue = def.defaultValue;
    this.options = def.options || [];
    this.validation = def.validation || {};
    this.conditional = def.conditional || null;
    this.computed = def.computed || null;
    this.transform = def.transform || null;
    this.order = def.order ?? 0;
    this.group = def.group || null;
    this.disabled = def.disabled || false;
    this.hidden = def.hidden || false;

    if (!FIELD_TYPES.includes(this.type)) throw new Error(`Unknown field type: ${this.type}`);
  }

  isVisible(context) {
    if (this.hidden) return false;
    if (!this.conditional) return true;
    return this._evalCondition(this.conditional, context);
  }

  _evalCondition(cond, ctx) {
    if (typeof cond === 'function') return cond(ctx);
    if (cond.and) return cond.and.every(c => this._evalCondition(c, ctx));
    if (cond.or) return cond.or.some(c => this._evalCondition(c, ctx));
    if (cond.not) return !this._evalCondition(cond.not, ctx);

    const { field, op, value } = cond;
    const actual = ctx[field];
    switch (op) {
      case 'eq': case '==': return actual === value;
      case 'neq': case '!=': return actual !== value;
      case 'gt': case '>': return actual > value;
      case 'gte': case '>=': return actual >= value;
      case 'lt': case '<': return actual < value;
      case 'lte': case '<=': return actual <= value;
      case 'in': return Array.isArray(value) && value.includes(actual);
      case 'nin': return Array.isArray(value) && !value.includes(actual);
      case 'contains': return Array.isArray(actual) ? actual.includes(value) : String(actual).includes(value);
      case 'exists': return actual !== undefined && actual !== null;
      case 'empty': return actual === undefined || actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0);
      case 'regex': return new RegExp(value).test(String(actual ?? ''));
      default: return false;
    }
  }

  validate(value, context) {
    const errors = [];
    const v = this.validation;

    // Required
    if (v.required) {
      const err = validators.required(value, true, this);
      if (err) { errors.push(err); return errors; }
    }

    // Skip further validation if empty and not required
    if (value === undefined || value === null || value === '') return errors;

    // Type-specific
    if (this.type === 'email') { const e = validators.email(value, null, this); if (e) errors.push(e); }
    if (this.type === 'url') { const e = validators.url(value, null, this); if (e) errors.push(e); }
    if (this.type === 'phone') { const e = validators.phone(value, null, this); if (e) errors.push(e); }

    // Validators
    for (const [key, param] of Object.entries(v)) {
      if (key === 'required' || !validators[key]) continue;
      const err = validators[key](value, param, this);
      if (err) errors.push(err);
    }

    return errors;
  }

  transformValue(value) {
    if (this.transform && typeof this.transform === 'function') return this.transform(value);
    if (this.transform === 'trim' && typeof value === 'string') return value.trim();
    if (this.transform === 'lowercase' && typeof value === 'string') return value.toLowerCase();
    if (this.transform === 'uppercase' && typeof value === 'string') return value.toUpperCase();
    if (this.transform === 'number') return Number(value);
    if (this.transform === 'boolean') return Boolean(value);
    return value;
  }

  computeValue(context) {
    if (this.type !== 'computed' || !this.computed) return undefined;
    if (typeof this.computed === 'function') return this.computed(context);
    // Expression: simple template
    let expr = this.computed;
    for (const [k, v] of Object.entries(context)) {
      expr = expr.replaceAll(`{{${k}}}`, String(v ?? ''));
    }
    try {
      return new Function('ctx', `with(ctx) { return ${expr}; }`)(context);
    } catch {
      return expr;
    }
  }

  toJSON() {
    return {
      name: this.name, type: this.type, label: this.label,
      placeholder: this.placeholder, description: this.description,
      defaultValue: this.defaultValue, options: this.options,
      validation: this.validation, conditional: this.conditional ? '[function/condition]' : null,
      order: this.order, group: this.group,
    };
  }
}

// ─── Form Response ──────────────────────────────────────────────────────────
class FormResponse {
  constructor(formId, data = {}) {
    this.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.formId = formId;
    this.data = { ...data };
    this.errors = {};
    this.status = 'draft'; // draft | submitted | approved | rejected
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.submittedAt = null;
    this.metadata = {};
  }

  set(field, value) {
    this.data[field] = value;
    this.updatedAt = new Date().toISOString();
  }

  get(field) {
    return this.data[field];
  }

  toJSON() {
    return {
      id: this.id, formId: this.formId, data: this.data,
      errors: this.errors, status: this.status,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
      submittedAt: this.submittedAt, metadata: this.metadata,
    };
  }
}

// ─── Form Definition ────────────────────────────────────────────────────────
class Form {
  constructor(def = {}) {
    this.id = def.id || `form-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.name = def.name || 'Untitled Form';
    this.description = def.description || '';
    this.fields = (def.fields || []).map(f => new FormField(f));
    this.steps = def.steps || null;
    this.settings = {
      allowMultiple: def.settings?.allowMultiple ?? true,
      requireAuth: def.settings?.requireAuth ?? false,
      autoSave: def.settings?.autoSave ?? false,
      submitText: def.settings?.submitText ?? 'Submit',
      successMessage: def.settings?.successMessage ?? 'Thank you!',
      ...def.settings,
    };
    this.tags = def.tags || [];
    this.createdAt = def.createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  getField(name) { return this.fields.find(f => f.name === name); }
  getFieldNames() { return this.fields.map(f => f.name); }

  getVisibleFields(context = {}) {
    return this.fields
      .filter(f => f.isVisible(context))
      .sort((a, b) => a.order - b.order);
  }

  getStepFields(stepIndex, context = {}) {
    if (!this.steps || !this.steps[stepIndex]) return this.getVisibleFields(context);
    const stepFieldNames = this.steps[stepIndex].fields || [];
    return this.fields
      .filter(f => stepFieldNames.includes(f.name) && f.isVisible(context))
      .sort((a, b) => a.order - b.order);
  }

  getStepCount() { return this.steps ? this.steps.length : 1; }

  toJSON() {
    return {
      id: this.id, name: this.name, description: this.description,
      fields: this.fields.map(f => f.toJSON()), steps: this.steps,
      settings: this.settings, tags: this.tags,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

// ─── Form Engine ────────────────────────────────────────────────────────────
class FormEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.forms = new Map();
    this.responses = new Map();
    this.persistPath = opts.persistPath || null;
    this.autoSave = opts.autoSave ?? true;

    if (this.persistPath) {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this._loadPersisted();
    }
  }

  // ── Form CRUD ───────────────────────────────────────────────────────────
  createForm(def) {
    const form = new Form(def);
    this.forms.set(form.id, form);
    this.responses.set(form.id, []);
    this._persist('form:create', { form: form.toJSON() });
    this.emit('form:create', form);
    return form;
  }

  getForm(id) {
    const f = this.forms.get(id);
    if (!f) throw new Error(`Form not found: ${id}`);
    return f;
  }

  listForms(tag) {
    const all = [...this.forms.values()];
    if (tag) return all.filter(f => f.tags.includes(tag));
    return all;
  }

  updateForm(id, updates) {
    const form = this.getForm(id);
    if (updates.name) form.name = updates.name;
    if (updates.description) form.description = updates.description;
    if (updates.fields) form.fields = updates.fields.map(f => new FormField(f));
    if (updates.steps) form.steps = updates.steps;
    if (updates.settings) Object.assign(form.settings, updates.settings);
    if (updates.tags) form.tags = updates.tags;
    form.updatedAt = new Date().toISOString();
    this._persist('form:update', { formId: id, updates });
    this.emit('form:update', form);
    return form;
  }

  deleteForm(id) {
    this.getForm(id); // throws if missing
    this.forms.delete(id);
    this.responses.delete(id);
    this._persist('form:delete', { formId: id });
    this.emit('form:delete', { formId: id });
    return true;
  }

  addField(formId, fieldDef) {
    const form = this.getForm(formId);
    const field = new FormField(fieldDef);
    form.fields.push(field);
    form.updatedAt = new Date().toISOString();
    this._persist('field:add', { formId, field: field.toJSON() });
    this.emit('field:add', { formId, field });
    return field;
  }

  removeField(formId, fieldName) {
    const form = this.getForm(formId);
    form.fields = form.fields.filter(f => f.name !== fieldName);
    form.updatedAt = new Date().toISOString();
    this._persist('field:remove', { formId, fieldName });
    this.emit('field:remove', { formId, fieldName });
    return true;
  }

  // ── Response CRUD ───────────────────────────────────────────────────────
  startResponse(formId) {
    const form = this.getForm(formId);
    const response = new FormResponse(formId);
    // Set defaults
    for (const field of form.fields) {
      if (field.defaultValue !== undefined && response.data[field.name] === undefined) {
        response.data[field.name] = field.defaultValue;
      }
    }
    const formResponses = this.responses.get(formId);
    formResponses.push(response);
    this._persist('response:start', { response: response.toJSON() });
    this.emit('response:start', { formId, response });
    return response;
  }

  getResponse(formId, responseId) {
    const formResponses = this.responses.get(formId);
    if (!formResponses) throw new Error(`Form not found: ${formId}`);
    const r = formResponses.find(r => r.id === responseId);
    if (!r) throw new Error(`Response not found: ${responseId}`);
    return r;
  }

  fillField(formId, responseId, fieldName, value) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    const field = form.getField(fieldName);
    if (!field) throw new Error(`Field not found: ${fieldName}`);

    // Transform
    const transformed = field.transformValue(value);
    response.set(fieldName, transformed);

    // Compute dependent fields
    for (const f of form.fields) {
      if (f.type === 'computed' && f.computed) {
        const cv = f.computeValue(response.data);
        if (cv !== undefined) response.set(f.name, cv);
      }
    }

    this._persist('response:fill', { formId, responseId, fieldName, value: transformed });
    this.emit('response:fill', { formId, responseId, fieldName, value: transformed });
    return response;
  }

  fillFields(formId, responseId, data) {
    const response = this.getResponse(formId, responseId);
    for (const [field, val] of Object.entries(data)) {
      this.fillField(formId, responseId, field, val);
    }
    return this.getResponse(formId, responseId);
  }

  validateResponse(formId, responseId) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    const errors = {};
    let valid = true;

    for (const field of form.fields) {
      if (field.type === 'computed') continue;
      if (!field.isVisible(response.data)) continue;
      const errs = field.validate(response.data[field.name], response.data);
      if (errs.length > 0) {
        errors[field.name] = errs;
        valid = false;
      }
    }

    response.errors = errors;
    this.emit('response:validate', { formId, responseId, valid, errors });
    return { valid, errors };
  }

  submitResponse(formId, responseId) {
    const { valid, errors } = this.validateResponse(formId, responseId);
    if (!valid) {
      this.emit('response:submit-failed', { formId, responseId, errors });
      return { success: false, errors };
    }

    const response = this.getResponse(formId, responseId);
    response.status = 'submitted';
    response.submittedAt = new Date().toISOString();
    response.updatedAt = response.submittedAt;

    this._persist('response:submit', { response: response.toJSON() });
    this.emit('response:submit', { formId, responseId, response });
    return { success: true, response };
  }

  getFormResponses(formId, status) {
    const formResponses = this.responses.get(formId);
    if (!formResponses) throw new Error(`Form not found: ${formId}`);
    if (status) return formResponses.filter(r => r.status === status);
    return formResponses;
  }

  getResponseStats(formId) {
    const formResponses = this.getFormResponses(formId);
    const byStatus = {};
    for (const r of formResponses) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }
    return {
      total: formResponses.length,
      byStatus,
      completionRate: formResponses.length > 0
        ? ((byStatus.submitted || 0) / formResponses.length * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  // ── Multi-step Wizard ───────────────────────────────────────────────────
  validateStep(formId, responseId, stepIndex) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    const stepFields = form.getStepFields(stepIndex, response.data);
    const errors = {};
    let valid = true;

    for (const field of stepFields) {
      if (field.type === 'computed') continue;
      const errs = field.validate(response.data[field.name], response.data);
      if (errs.length > 0) {
        errors[field.name] = errs;
        valid = false;
      }
    }

    return { valid, errors, step: stepIndex, totalSteps: form.getStepCount() };
  }

  getCurrentStep(formId, responseId) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    for (let i = 0; i < form.getStepCount(); i++) {
      const { valid } = this.validateStep(formId, responseId, i);
      if (!valid) return { step: i, totalSteps: form.getStepCount() };
    }
    return { step: form.getStepCount() - 1, totalSteps: form.getStepCount(), complete: true };
  }

  // ── Natural Language Bridge ─────────────────────────────────────────────
  getNextField(formId, responseId) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    const visible = form.getVisibleFields(response.data);

    for (const field of visible) {
      if (field.type === 'computed') continue;
      const val = response.data[field.name];
      if (val === undefined || val === null || val === '') {
        const errs = field.validate(val, response.data);
        if (errs.length > 0 || field.validation.required) {
          return {
            field: field.toJSON(),
            prompt: this._generatePrompt(field, response.data),
            index: visible.indexOf(field),
            total: visible.length,
          };
        }
      }
    }
    return null; // all filled
  }

  _generatePrompt(field, context) {
    const parts = [];
    const label = field.label || field.name;
    const req = field.validation.required ? ' (required)' : '';

    switch (field.type) {
      case 'select': case 'radio':
        parts.push(`${label}${req}: Please choose one of: ${field.options.map(o => typeof o === 'string' ? o : o.label || o.value).join(', ')}`);
        break;
      case 'multiselect':
        parts.push(`${label}${req}: Please select one or more from: ${field.options.map(o => typeof o === 'string' ? o : o.label || o.value).join(', ')}`);
        break;
      case 'boolean': case 'checkbox':
        parts.push(`${label}${req}: Yes or No?`);
        break;
      case 'rating':
        const max = field.validation.max || 5;
        parts.push(`${label}${req}: Rate from 1 to ${max}`);
        break;
      case 'number': case 'slider':
        parts.push(`${label}${req}: Enter a number`);
        break;
      case 'date':
        parts.push(`${label}${req}: Enter a date (YYYY-MM-DD)`);
        break;
      case 'email':
        parts.push(`${label}${req}: Enter your email address`);
        break;
      default:
        parts.push(`${label}${req}:`);
    }

    if (field.description) parts.push(`  (${field.description})`);
    if (field.placeholder) parts.push(`  e.g., ${field.placeholder}`);

    return parts.join('\n');
  }

  getProgress(formId, responseId) {
    const form = this.getForm(formId);
    const response = this.getResponse(formId, responseId);
    const visible = form.getVisibleFields(response.data);
    const editable = visible.filter(f => f.type !== 'computed');
    const filled = editable.filter(f => {
      const v = response.data[f.name];
      return v !== undefined && v !== null && v !== '';
    });
    return {
      filled: filled.length,
      total: editable.length,
      percent: editable.length > 0 ? Math.round(filled.length / editable.length * 100) : 100,
      fields: editable.map(f => ({
        name: f.name,
        label: f.label,
        filled: response.data[f.name] !== undefined && response.data[f.name] !== null && response.data[f.name] !== '',
        hasError: response.errors[f.name]?.length > 0,
      })),
    };
  }

  // ── Export ───────────────────────────────────────────────────────────────
  exportCSV(formId) {
    const form = this.getForm(formId);
    const responses = this.getFormResponses(formId);
    const headers = form.getFieldNames();
    const lines = [headers.join(',')];
    for (const r of responses) {
      const row = headers.map(h => {
        let v = r.data[h];
        if (v === undefined || v === null) v = '';
        if (Array.isArray(v)) v = v.join(';');
        if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
          v = `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      });
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  exportJSON(formId) {
    const form = this.getForm(formId);
    const responses = this.getFormResponses(formId);
    return {
      form: form.toJSON(),
      responses: responses.map(r => r.toJSON()),
      stats: this.getResponseStats(formId),
    };
  }

  // ── Aggregate & Analyze ─────────────────────────────────────────────────
  aggregate(formId, fieldName) {
    const form = this.getForm(formId);
    const field = form.getField(fieldName);
    if (!field) throw new Error(`Field not found: ${fieldName}`);
    const responses = this.getFormResponses(formId, 'submitted');
    const values = responses.map(r => r.data[fieldName]).filter(v => v !== undefined && v !== null);

    if (['number', 'rating', 'slider'].includes(field.type)) {
      const nums = values.map(Number).filter(n => !isNaN(n));
      if (nums.length === 0) return { type: 'numeric', count: 0 };
      nums.sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      return {
        type: 'numeric', count: nums.length,
        mean: +(sum / nums.length).toFixed(2),
        median: nums[Math.floor(nums.length / 2)],
        min: nums[0], max: nums[nums.length - 1],
        sum: +sum.toFixed(2),
        stddev: +Math.sqrt(nums.reduce((s, n) => s + (n - sum / nums.length) ** 2, 0) / nums.length).toFixed(2),
      };
    }

    if (['select', 'radio', 'boolean'].includes(field.type)) {
      const dist = {};
      for (const v of values) dist[String(v)] = (dist[String(v)] || 0) + 1;
      return { type: 'categorical', count: values.length, distribution: dist };
    }

    if (['multiselect', 'checkbox'].includes(field.type)) {
      const dist = {};
      for (const v of values) {
        const items = Array.isArray(v) ? v : [v];
        for (const item of items) dist[String(item)] = (dist[String(item)] || 0) + 1;
      }
      return { type: 'multi-categorical', count: values.length, distribution: dist };
    }

    return { type: 'raw', count: values.length, values: values.slice(0, 100) };
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  _persist(event, data) {
    if (!this.persistPath) return;
    try {
      appendFileSync(this.persistPath + '.events.jsonl',
        JSON.stringify({ event, data, ts: Date.now() }) + '\n');
      if (this.autoSave) this._snapshot();
    } catch {}
  }

  _snapshot() {
    if (!this.persistPath) return;
    try {
      const data = {
        forms: Object.fromEntries([...this.forms.entries()].map(([k, v]) => [k, v.toJSON()])),
        responses: Object.fromEntries([...this.responses.entries()].map(([k, v]) => [k, v.map(r => r.toJSON())])),
      };
      writeFileSync(this.persistPath + '.json', JSON.stringify(data, null, 2));
    } catch {}
  }

  save() { this._snapshot(); }

  _loadPersisted() {
    if (!this.persistPath) return;
    const snapPath = this.persistPath + '.json';
    if (!existsSync(snapPath)) return;
    try {
      const data = JSON.parse(readFileSync(snapPath, 'utf8'));
      for (const [id, fd] of Object.entries(data.forms || {})) {
        this.forms.set(id, new Form(fd));
      }
      for (const [id, rds] of Object.entries(data.responses || {})) {
        this.responses.set(id, rds.map(rd => {
          const r = new FormResponse(rd.formId, rd.data);
          Object.assign(r, rd);
          return r;
        }));
      }
    } catch {}
  }

  // ── Quick Form Builder ──────────────────────────────────────────────────
  static quickForm(name, fieldDefs) {
    return new Form({
      name,
      fields: fieldDefs.map((f, i) => typeof f === 'string'
        ? { name: f, type: 'text', label: f, order: i }
        : { order: i, ...f }),
    });
  }

  stats() {
    return {
      forms: this.forms.size,
      totalResponses: [...this.responses.values()].reduce((s, r) => s + r.length, 0),
      formStats: Object.fromEntries([...this.forms.keys()].map(id => [id, this.getResponseStats(id)])),
    };
  }
}

export { FormEngine, Form, FormField, FormResponse, validators, FIELD_TYPES };
export default FormEngine;

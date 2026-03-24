/**
 * agent-secrets — zero-dep secrets manager for AI agents
 * 
 * Features:
 * - AES-256-GCM encryption with master password
 * - Namespace isolation for multi-env secrets
 * - Secret rotation tracking with expiration
 * - Import/export (encrypted JSON)
 * - Audit logging (JSONL)
 * - Environment variable injection
 * - EventEmitter integration
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, appendFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SCRYPT_N = 16384;

function deriveKey(password, salt) {
  return scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: 8, p: 1 });
}

function encrypt(plaintext, password) {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

function decrypt(encoded, password) {
  const buf = Buffer.from(encoded, 'base64');
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function now() { return Date.now(); }

export class AgentSecrets extends EventEmitter {
  #password;
  #secrets = new Map();       // id -> { id, namespace, key, encryptedValue, metadata, createdAt, updatedAt, expiresAt, rotatedAt, rotationInterval, tags }
  #namespaces = new Set(['default']);
  #auditLog = [];
  #persistPath;
  #auditPath;
  #autoSaveTimer;
  #maxSecrets;
  #defaultTTL;

  constructor(options = {}) {
    super();
    this.#password = options.password || 'agent-secrets-default';
    this.#persistPath = options.persistPath || null;
    this.#auditPath = options.auditPath || null;
    this.#maxSecrets = options.maxSecrets || 10000;
    this.#defaultTTL = options.defaultTTL || 0; // 0 = no expiry

    if (options.autoSaveMs && this.#persistPath) {
      this.#autoSaveTimer = setInterval(() => this.save().catch(() => {}), options.autoSaveMs);
    }
  }

  // ─── Core Operations ───

  set(key, value, options = {}) {
    const ns = options.namespace || 'default';
    const id = options.id || this.#findId(ns, key) || generateId();
    const existing = this.#secrets.get(id);
    const ttl = options.ttl !== undefined ? options.ttl : this.#defaultTTL;

    const entry = {
      id,
      namespace: ns,
      key,
      encryptedValue: encrypt(String(value), this.#password),
      metadata: options.metadata || (existing?.metadata) || {},
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      expiresAt: ttl !== 0 ? now() + ttl * 1000 : null,
      rotatedAt: existing ? now() : null,
      rotationInterval: options.rotationInterval || existing?.rotationInterval || null,
      tags: options.tags || existing?.tags || [],
    };

    this.#secrets.set(id, entry);
    this.#namespaces.add(ns);

    // Evict if over limit
    if (this.#secrets.size > this.#maxSecrets) {
      const oldest = [...this.#secrets.values()].sort((a, a2) => a.createdAt - a2.createdAt)[0];
      if (oldest) {
        this.#secrets.delete(oldest.id);
        this.#logAudit('evict', oldest.id, oldest.namespace, oldest.key);
      }
    }

    this.#logAudit(existing ? 'update' : 'create', id, ns, key);
    this.emit('set', { id, namespace: ns, key });
    return { id, namespace: ns, key, createdAt: entry.createdAt, updatedAt: entry.updatedAt, expiresAt: entry.expiresAt };
  }

  get(idOrKey, options = {}) {
    const ns = options.namespace || 'default';
    const entry = this.#resolve(idOrKey, ns);
    if (!entry) return null;

    // Check expiration
    if (entry.expiresAt && now() > entry.expiresAt) {
      this.delete(entry.id);
      this.#logAudit('expire', entry.id, entry.namespace, entry.key);
      this.emit('expire', { id: entry.id, namespace: entry.namespace, key: entry.key });
      return null;
    }

    // Check rotation needed
    if (entry.rotationInterval && entry.rotatedAt && (now() - entry.rotatedAt > entry.rotationInterval * 1000)) {
      this.#logAudit('rotation_needed', entry.id, entry.namespace, entry.key);
      this.emit('rotation_needed', { id: entry.id, namespace: entry.namespace, key: entry.key, lastRotated: entry.rotatedAt });
    }

    const value = decrypt(entry.encryptedValue, this.#password);
    this.#logAudit('read', entry.id, entry.namespace, entry.key);
    this.emit('get', { id: entry.id, namespace: entry.namespace, key: entry.key });

    return {
      id: entry.id,
      namespace: entry.namespace,
      key: entry.key,
      value: options.raw ? value : value,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      rotatedAt: entry.rotatedAt,
      rotationInterval: entry.rotationInterval,
      tags: entry.tags,
      needsRotation: entry.rotationInterval && entry.rotatedAt && (now() - entry.rotatedAt > entry.rotationInterval * 1000),
    };
  }

  delete(idOrKey, options = {}) {
    const ns = options.namespace || 'default';
    const entry = this.#resolve(idOrKey, ns);
    if (!entry) return false;
    this.#secrets.delete(entry.id);
    this.#logAudit('delete', entry.id, entry.namespace, entry.key);
    this.emit('delete', { id: entry.id, namespace: entry.namespace, key: entry.key });
    return true;
  }

  has(idOrKey, options = {}) {
    const ns = options.namespace || 'default';
    const entry = this.#resolve(idOrKey, ns);
    if (!entry) return false;
    if (entry.expiresAt && now() > entry.expiresAt) return false;
    return true;
  }

  list(options = {}) {
    const ns = options.namespace;
    const tag = options.tag;
    let entries = [...this.#secrets.values()];

    if (ns) entries = entries.filter(e => e.namespace === ns);
    if (tag) entries = entries.filter(e => e.tags.includes(tag));

    return entries.map(e => ({
      id: e.id,
      namespace: e.namespace,
      key: e.key,
      metadata: e.metadata,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      expiresAt: e.expiresAt,
      rotatedAt: e.rotatedAt,
      tags: e.tags,
      expired: e.expiresAt ? now() > e.expiresAt : false,
      needsRotation: e.rotationInterval && e.rotatedAt && (now() - e.rotatedAt > e.rotationInterval * 1000),
    }));
  }

  keys(namespace) {
    return this.list({ namespace }).map(e => e.key);
  }

  // ─── Namespace Operations ───

  namespaces() {
    return [...this.#namespaces];
  }

  deleteNamespace(namespace) {
    const entries = [...this.#secrets.values()].filter(e => e.namespace === namespace);
    for (const e of entries) this.#secrets.delete(e.id);
    this.#namespaces.delete(namespace);
    this.#logAudit('delete_namespace', null, namespace, null);
    this.emit('delete_namespace', namespace);
    return entries.length;
  }

  // ─── Rotation ───

  rotate(idOrKey, newValue, options = {}) {
    const ns = options.namespace || 'default';
    const entry = this.#resolve(idOrKey, ns);
    if (!entry) return null;

    entry.encryptedValue = encrypt(String(newValue), this.#password);
    entry.rotatedAt = now();
    entry.updatedAt = now();

    this.#logAudit('rotate', entry.id, entry.namespace, entry.key);
    this.emit('rotate', { id: entry.id, namespace: entry.namespace, key: entry.key });
    return { id: entry.id, namespace: entry.namespace, key: entry.key, rotatedAt: entry.rotatedAt };
  }

  needsRotation(options = {}) {
    const ns = options.namespace;
    let entries = [...this.#secrets.values()];
    if (ns) entries = entries.filter(e => e.namespace === ns);

    return entries
      .filter(e => e.rotationInterval && e.rotatedAt && (now() - e.rotatedAt > e.rotationInterval * 1000))
      .map(e => ({
        id: e.id,
        namespace: e.namespace,
        key: e.key,
        rotatedAt: e.rotatedAt,
        rotationInterval: e.rotationInterval,
        overdue: Math.round((now() - e.rotatedAt - e.rotationInterval * 1000) / 1000),
      }));
  }

  // ─── Environment Export ───

  toEnv(namespace, prefix = '') {
    const entries = this.list({ namespace }).filter(e => !e.expired);
    const env = {};
    for (const e of entries) {
      const full = this.get(e.id, { namespace });
      if (full) {
        const envKey = prefix + e.key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        env[envKey] = full.value;
      }
    }
    return env;
  }

  injectEnv(namespace, prefix = '') {
    const env = this.toEnv(namespace, prefix);
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }
    return Object.keys(env).length;
  }

  // ─── Import / Export ───

  exportEncrypted(namespace) {
    const entries = namespace
      ? [...this.#secrets.values()].filter(e => e.namespace === namespace)
      : [...this.#secrets.values()];

    const exportData = entries.map(e => ({
      ...e,
      encryptedValue: e.encryptedValue, // stays encrypted
    }));

    return encrypt(JSON.stringify(exportData), this.#password);
  }

  importEncrypted(encoded, options = {}) {
    const data = JSON.parse(decrypt(encoded, this.#password));
    let imported = 0;

    for (const entry of data) {
      if (options.overwrite || !this.#secrets.has(entry.id)) {
        this.#secrets.set(entry.id, { ...entry });
        this.#namespaces.add(entry.namespace);
        imported++;
      }
    }

    this.#logAudit('import', null, null, `${imported} secrets`);
    this.emit('import', { count: imported });
    return imported;
  }

  exportPlaintext(namespace) {
    const entries = this.list({ namespace }).filter(e => !e.expired);
    return entries.map(e => {
      const full = this.get(e.id, { namespace: e.namespace });
      return {
        namespace: e.namespace,
        key: e.key,
        value: full?.value || null,
        metadata: e.metadata,
        tags: e.tags,
      };
    });
  }

  // ─── Search ───

  search(query, options = {}) {
    const ns = options.namespace;
    const q = query.toLowerCase();
    let entries = [...this.#secrets.values()];
    if (ns) entries = entries.filter(e => e.namespace === ns);

    return entries
      .filter(e =>
        e.key.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q)) ||
        JSON.stringify(e.metadata).toLowerCase().includes(q)
      )
      .map(e => ({
        id: e.id,
        namespace: e.namespace,
        key: e.key,
        createdAt: e.createdAt,
        tags: e.tags,
      }));
  }

  // ─── Audit ───

  getAuditLog(options = {}) {
    let log = [...this.#auditLog];
    if (options.namespace) log = log.filter(l => l.namespace === options.namespace);
    if (options.action) log = log.filter(l => l.action === options.action);
    if (options.since) log = log.filter(l => l.timestamp >= options.since);
    if (options.limit) log = log.slice(-options.limit);
    return log;
  }

  // ─── Stats ───

  stats() {
    const entries = [...this.#secrets.values()];
    const nowMs = now();
    const byNamespace = {};
    const expired = entries.filter(e => e.expiresAt && nowMs > e.expiresAt).length;
    const needsRotation = entries.filter(e => e.rotationInterval && e.rotatedAt && (nowMs - e.rotatedAt > e.rotationInterval * 1000)).length;

    for (const e of entries) {
      byNamespace[e.namespace] = (byNamespace[e.namespace] || 0) + 1;
    }

    return {
      total: entries.length,
      namespaces: this.#namespaces.size,
      expired,
      needsRotation,
      byNamespace,
      auditLogSize: this.#auditLog.length,
    };
  }

  // ─── Persistence ───

  async save() {
    if (!this.#persistPath) return;
    await mkdir(dirname(this.#persistPath), { recursive: true });
    const data = {
      secrets: [...this.#secrets.entries()],
      namespaces: [...this.#namespaces],
    };
    await writeFile(this.#persistPath, encrypt(JSON.stringify(data), this.#password), 'utf8');
    this.emit('save');
  }

  async load() {
    if (!this.#persistPath) return;
    try {
      const raw = await readFile(this.#persistPath, 'utf8');
      const data = JSON.parse(decrypt(raw, this.#password));
      this.#secrets = new Map(data.secrets);
      this.#namespaces = new Set(data.namespaces);
      this.emit('load', { count: this.#secrets.size });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  destroy() {
    if (this.#autoSaveTimer) clearInterval(this.#autoSaveTimer);
    this.#secrets.clear();
    this.#auditLog = [];
  }

  // ─── Internal ───

  #resolve(idOrKey, namespace) {
    if (this.#secrets.has(idOrKey)) return this.#secrets.get(idOrKey);
    return this.#findEntry(namespace, idOrKey);
  }

  #findEntry(namespace, key) {
    for (const entry of this.#secrets.values()) {
      if (entry.namespace === namespace && entry.key === key) return entry;
    }
    return null;
  }

  #findId(namespace, key) {
    const entry = this.#findEntry(namespace, key);
    return entry?.id || null;
  }

  #logAudit(action, id, namespace, key) {
    const record = { timestamp: now(), action, id, namespace, key };
    this.#auditLog.push(record);
    if (this.#auditLog.length > 10000) this.#auditLog = this.#auditLog.slice(-5000);

    if (this.#auditPath) {
      appendFile(this.#auditPath, JSON.stringify(record) + '\n').catch(() => {});
    }

    this.emit('audit', record);
  }
}

export default AgentSecrets;

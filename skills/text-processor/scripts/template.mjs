#!/usr/bin/env node
/**
 * template.mjs — Simple template engine for text-processor skill
 * Usage: node template.mjs --template="Hello {name}!" --data='{"name":"Alice"}'
 *        node template.mjs --template-file=tpl.txt --data-file=data.json
 *        echo '{"name":"Alice"}' | node template.mjs --template="Hello {name}!"
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

let template = getArg('template');
const templateFile = getArg('template-file');
let dataStr = getArg('data');
const dataFile = getArg('data-file');

if (templateFile) {
  template = readFileSync(templateFile, 'utf8');
}

if (!template) {
  console.error('Usage: node template.mjs --template="..." [--data=\'{"key":"val"}\' | --data-file=data.json]');
  console.error('       echo \'{"key":"val"}\' | node template.mjs --template="..."');
  process.exit(1);
}

if (dataFile) {
  dataStr = readFileSync(dataFile, 'utf8');
} else if (!dataStr) {
  // Try stdin
  try {
    dataStr = readFileSync('/dev/stdin', 'utf8').trim();
  } catch {}
}

let data = {};
if (dataStr) {
  try {
    data = JSON.parse(dataStr);
  } catch (e) {
    console.error(`Invalid JSON data: ${e.message}`);
    process.exit(1);
  }
}

function resolveValue(obj, path) {
  return path.split('.').reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
}

function applyTransform(value, transform) {
  const [fn, ...fnArgs] = transform.split(':');
  switch (fn) {
    case 'upper': return String(value).toUpperCase();
    case 'lower': return String(value).toLowerCase();
    case 'title': return String(value).replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
    case 'trim': return String(value).trim();
    case 'length': return Array.isArray(value) ? value.length : String(value).length;
    case 'join': return Array.isArray(value) ? value.join(fnArgs[0] || ', ') : value;
    case 'first': return Array.isArray(value) ? value[0] : value;
    case 'last': return Array.isArray(value) ? value[value.length - 1] : value;
    case 'fixed': return Number(value).toFixed(parseInt(fnArgs[0]) || 2);
    case 'default': return value || fnArgs[0];
    case 'json': return JSON.stringify(value);
    case 'json-pretty': return JSON.stringify(value, null, 2);
    default: return value;
  }
}

function processTemplate(tpl, data) {
  return tpl.replace(/\{([^}]+)\}/g, (match, expr) => {
    // Handle pipe transforms: {key|transform1|transform2}
    const parts = expr.split('|').map(s => s.trim());
    const keyPath = parts[0];
    const transforms = parts.slice(1);

    // Handle default value: {key|default:fallback}
    let value;
    if (keyPath.includes('|')) {
      // Already handled by split above
      value = resolveValue(data, keyPath);
    } else {
      value = resolveValue(data, keyPath);
    }

    if (value === undefined || value === null) {
      // Check for default transform
      const defaultTransform = transforms.find(t => t.startsWith('default:'));
      if (defaultTransform) {
        value = defaultTransform.split(':').slice(1).join(':');
      } else {
        return match; // Leave unresolved
      }
    }

    // Apply transforms
    for (const t of transforms) {
      if (!t.startsWith('default:') || value !== undefined) {
        value = applyTransform(value, t);
      }
    }

    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

// Handle conditionals: {#if key}...{/if}
function processConditionals(tpl, data) {
  return tpl.replace(/\{#if\s+([^}]+)\}([\s\S]*?)\{\/if\}/g, (match, key, content) => {
    const val = resolveValue(data, key.trim());
    if (val && (!Array.isArray(val) || val.length > 0)) {
      return processTemplate(content, data);
    }
    return '';
  });
}

// Handle loops: {#each items}...{/each}
function processLoops(tpl, data) {
  return tpl.replace(/\{#each\s+([^}]+)\}([\s\S]*?)\{\/each\}/g, (match, key, content) => {
    const items = resolveValue(data, key.trim());
    if (!Array.isArray(items)) return '';
    return items.map((item, index) => {
      const itemData = typeof item === 'object' ? { ...item, '@index': index, '@first': index === 0, '@last': index === items.length - 1 } : { '@item': item, '@index': index };
      return processTemplate(content, { ...data, ...itemData });
    }).join('');
  });
}

let result = processLoops(template, data);
result = processConditionals(result, data);
result = processTemplate(result, data);
console.log(result);

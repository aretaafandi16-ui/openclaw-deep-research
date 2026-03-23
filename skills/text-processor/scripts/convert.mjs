#!/usr/bin/env node
/**
 * convert.mjs — Format conversion tool for text-processor skill
 * Usage: echo '...' | node convert.mjs <command> [--file=path] [--delimiter=,]
 * Commands: json2csv, json2md, json2yaml, json2text, csv2json, csv2md, md2json, md2csv, yaml2json
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--'));
const fileArg = args.find(a => a.startsWith('--file='));
const delimArg = args.find(a => a.startsWith('--delimiter='));
const delimiter = delimArg ? delimArg.split('=')[1] : ',';

let input;
if (fileArg) {
  input = readFileSync(fileArg.split('=')[1], 'utf8').trim();
} else {
  input = readFileSync('/dev/stdin', 'utf8').trim();
}

if (!input) {
  console.error('Error: No input provided');
  process.exit(1);
}

function jsonToCsv(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const headers = [...new Set(data.flatMap(Object.keys))];
  const rows = data.map(row => 
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(delimiter)
  );
  return [headers.join(delimiter), ...rows].join('\n');
}

function jsonToMarkdown(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const headers = [...new Set(data.flatMap(Object.keys))];
  const sep = headers.map(() => '---');
  const rows = data.map(row =>
    '| ' + headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      return String(val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }).join(' | ') + ' |'
  );
  return ['| ' + headers.join(' | ') + ' |', '| ' + sep.join(' | ') + ' |', ...rows].join('\n');
}

function jsonToYaml(data, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(data)) {
    return data.map(item => {
      if (typeof item === 'object' && item !== null) {
        const inner = Object.entries(item).map(([k, v]) => {
          if (typeof v === 'object') return `${pad}  ${k}:\n${jsonToYaml(v, indent + 2)}`;
          return `${pad}  ${k}: ${yamlValue(v)}`;
        }).join('\n');
        return `${pad}- \n${inner}`;
      }
      return `${pad}- ${yamlValue(item)}`;
    }).join('\n');
  }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([k, v]) => {
      if (typeof v === 'object') return `${pad}${k}:\n${jsonToYaml(v, indent + 1)}`;
      return `${pad}${k}: ${yamlValue(v)}`;
    }).join('\n');
  }
  return String(data);
}

function yamlValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes('"') || v.trim() !== v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return String(v);
}

function jsonToText(data) {
  if (Array.isArray(data)) {
    return data.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('\n');
  }
  return JSON.stringify(data, null, 2);
}

function csvToJson(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0], delimiter);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line, delimiter);
    const obj = {};
    headers.forEach((h, i) => {
      let val = values[i] || '';
      if (!isNaN(val) && val !== '') val = Number(val);
      obj[h] = val;
    });
    return obj;
  });
}

function csvToMd(csv) {
  return jsonToMarkdown(csvToJson(csv));
}

function parseCsvLine(line, delim) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i+1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delim) { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function mdToJson(md) {
  const lines = md.split('\n').filter(l => l.trim());
  if (lines.length < 3) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  // Skip separator line (line[1])
  return lines.slice(2).map(line => {
    const values = line.split('|').map(v => v.trim()).filter((v, i, arr) => i > 0 && i < arr.length - 1 || v !== '');
    // Actually re-parse properly
    const cells = [];
    let inCell = false, cell = '';
    for (const ch of line) {
      if (ch === '|') {
        if (inCell) { cells.push(cell.trim()); cell = ''; inCell = false; }
        else inCell = true;
      } else if (inCell) cell += ch;
    }
    if (cell.trim()) cells.push(cell.trim());
    const obj = {};
    headers.forEach((h, i) => {
      let val = cells[i] || '';
      val = val.replace(/\\\|/g, '|');
      if (!isNaN(val) && val !== '') val = Number(val);
      obj[h] = val;
    });
    return obj;
  });
}

function mdToCsv(md) {
  return jsonToCsv(mdToJson(md));
}

function yamlToJson(yaml) {
  // Simple YAML parser for flat/nested objects and arrays
  const lines = yaml.split('\n');
  return parseYamlLines(lines, 0).value;
}

function parseYamlLines(lines, baseIndent) {
  const result = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const indent = line.search(/\S/);
    if (indent < baseIndent) break;
    
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      // Array
      const arr = [];
      while (i < lines.length) {
        const al = lines[i];
        if (!al.trim()) { i++; continue; }
        const ai = al.search(/\S/);
        if (ai < baseIndent) break;
        const at = al.trim();
        if (!at.startsWith('- ')) break;
        const content = at.substring(2);
        if (content.includes(': ')) {
          const obj = {};
          const [k, ...vParts] = content.split(': ');
          obj[k.trim()] = parseYamlValue(vParts.join(': '));
          // Check for more keys at deeper indent
          i++;
          while (i < lines.length) {
            const nl = lines[i];
            if (!nl.trim()) { i++; continue; }
            const ni = nl.search(/\S/);
            if (ni <= ai + 2 && !nl.trim().startsWith('- ')) break;
            if (ni <= baseIndent) break;
            if (nl.trim().startsWith('- ')) break;
            const nt = nl.trim();
            if (nt.includes(': ')) {
              const [nk, ...nvParts] = nt.split(': ');
              obj[nk.trim()] = parseYamlValue(nvParts.join(': '));
            }
            i++;
          }
          arr.push(obj);
        } else {
          arr.push(parseYamlValue(content));
          i++;
        }
      }
      return { value: arr, index: i };
    }
    
    if (trimmed.includes(': ')) {
      const colonIdx = trimmed.indexOf(': ');
      const key = trimmed.substring(0, colonIdx).trim();
      const val = trimmed.substring(colonIdx + 2).trim();
      if (val === '' || val === '|' || val === '>') {
        // Nested object or block
        const subLines = [];
        i++;
        while (i < lines.length) {
          const sl = lines[i];
          if (sl.trim() && sl.search(/\S/) <= indent) break;
          subLines.push(sl);
          i++;
        }
        const sub = parseYamlLines(subLines, indent + 2);
        result[key] = sub.value;
      } else {
        result[key] = parseYamlValue(val);
        i++;
      }
    } else if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1).trim();
      const subLines = [];
      i++;
      while (i < lines.length) {
        const sl = lines[i];
        if (sl.trim() && sl.search(/\S/) <= indent) break;
        subLines.push(sl);
        i++;
      }
      const sub = parseYamlLines(subLines, indent + 2);
      result[key] = sub.value;
    } else {
      i++;
    }
  }
  return { value: result, index: i };
}

function parseYamlValue(v) {
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (!isNaN(v) && v !== '') return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// Main
try {
  let data;
  switch (command) {
    case 'json2csv':
      data = JSON.parse(input);
      console.log(jsonToCsv(Array.isArray(data) ? data : [data]));
      break;
    case 'json2md':
      data = JSON.parse(input);
      console.log(jsonToMarkdown(Array.isArray(data) ? data : [data]));
      break;
    case 'json2yaml':
      data = JSON.parse(input);
      console.log(jsonToYaml(data));
      break;
    case 'json2text':
      data = JSON.parse(input);
      console.log(jsonToText(data));
      break;
    case 'csv2json':
      console.log(JSON.stringify(csvToJson(input), null, 2));
      break;
    case 'csv2md':
      console.log(csvToMd(input));
      break;
    case 'md2json':
      console.log(JSON.stringify(mdToJson(input), null, 2));
      break;
    case 'md2csv':
      console.log(mdToCsv(input));
      break;
    case 'yaml2json':
      console.log(JSON.stringify(yamlToJson(input), null, 2));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: json2csv, json2md, json2yaml, json2text, csv2json, csv2md, md2json, md2csv, yaml2json');
      process.exit(1);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

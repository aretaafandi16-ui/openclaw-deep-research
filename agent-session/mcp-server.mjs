#!/usr/bin/env node
/**
 * agent-session MCP Server — 10 tools via JSON-RPC stdio
 */

import { SessionManager } from './index.mjs';

const sm = new SessionManager({
  persistDir: process.env.PERSIST_DIR ?? null,
  defaultTTL: parseInt(process.env.DEFAULT_TTL ?? '1800000'),
  maxSessions: parseInt(process.env.MAX_SESSIONS ?? '10000'),
  maxMessages: parseInt(process.env.MAX_MESSAGES ?? '500')
});

const TOOLS = {
  session_create: {
    description: 'Create a new session',
    inputSchema: { type:'object', properties: {
      id:{type:'string',description:'Custom session ID (auto-generated if omitted)'},
      owner:{type:'string',description:'Session owner identifier'},
      namespace:{type:'string',default:'default',description:'Namespace for isolation'},
      tags:{type:'array',items:{type:'string'},description:'Tags for filtering'},
      ttl:{type:'number',default:1800000,description:'TTL in ms (0=no expiry)'},
      metadata:{type:'object',description:'Custom metadata'}
    }}
  },
  session_get: {
    description: 'Get a session by ID (auto-touches)',
    inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] }
  },
  session_touch: {
    description: 'Refresh session TTL',
    inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] }
  },
  session_destroy: {
    description: 'Destroy a session',
    inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] }
  },
  session_list: {
    description: 'List sessions with optional filters',
    inputSchema: { type:'object', properties: {
      owner:{type:'string'}, namespace:{type:'string'}, tag:{type:'string'},
      limit:{type:'number'}, offset:{type:'number'}
    }}
  },
  session_message_add: {
    description: 'Add a message to session conversation',
    inputSchema: { type:'object', properties: {
      sessionId:{type:'string'}, role:{type:'string',enum:['user','assistant','system','tool']},
      content:{type:'string'}, metadata:{type:'object'}
    }, required:['sessionId','role','content'] }
  },
  session_message_get: {
    description: 'Get messages from a session',
    inputSchema: { type:'object', properties: {
      sessionId:{type:'string'}, role:{type:'string'}, limit:{type:'number'}, since:{type:'number'}
    }, required:['sessionId'] }
  },
  session_state: {
    description: 'Get or set session state key-value pairs',
    inputSchema: { type:'object', properties: {
      sessionId:{type:'string'}, key:{type:'string'}, value:{}, action:{type:'string',enum:['get','set','delete','all']}
    }, required:['sessionId','action'] }
  },
  session_extend: {
    description: 'Extend session TTL',
    inputSchema: { type:'object', properties: {
      id:{type:'string'}, ttl:{type:'number',description:'New TTL in ms'}
    }, required:['id','ttl'] }
  },
  session_stats: {
    description: 'Get session manager statistics',
    inputSchema: { type:'object', properties: {} }
  }
};

function handle(tool, args) {
  switch (tool) {
    case 'session_create': return sm.create(args);
    case 'session_get': return sm.get(args.id);
    case 'session_touch': return sm.touch(args.id);
    case 'session_destroy': return sm.destroy(args.id);
    case 'session_list': return sm.list(args);
    case 'session_message_add': return sm.addMessage(args.sessionId, args.role, args.content, args);
    case 'session_message_get': return sm.getMessages(args.sessionId, args);
    case 'session_state': {
      if (args.action === 'set') return sm.setState(args.sessionId, args.key, args.value);
      if (args.action === 'delete') { sm.deleteState(args.sessionId, args.key); return { ok: true }; }
      return sm.getState(args.sessionId, args.key);
    }
    case 'session_extend': return sm.extend(args.id, args.ttl);
    case 'session_stats': return sm.stats();
    default: throw new Error(`Unknown tool: ${tool}`);
  }
}

let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    if (req.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:req.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'agent-session', version:'1.0.0' }}}) + '\n');
    } else if (req.method === 'notifications/initialized') {
      // no response needed
    } else if (req.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:req.id, result:{ tools: Object.entries(TOOLS).map(([name,t])=>({name,...t})) }}) + '\n');
    } else if (req.method === 'tools/call') {
      try {
        const result = handle(req.params.name, req.params.arguments ?? {});
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:req.id, result:{ content:[{type:'text',text:JSON.stringify(result,null,2)}] }}) + '\n');
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:req.id, result:{ content:[{type:'text',text:'Error: '+e.message}], isError:true }}) + '\n');
      }
    }
  }
});

process.stdin.resume();

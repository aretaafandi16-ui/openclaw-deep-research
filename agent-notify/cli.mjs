#!/usr/bin/env node
// agent-notify CLI — multi-channel notification dispatcher

import { AgentNotify, Priority, createChannel, PriorityName } from './index.mjs';

const USAGE = `
agent-notify — Multi-channel notification dispatcher for AI agents

USAGE
  agent-notify <command> [options]

COMMANDS
  send <body>              Send a notification
    --title <t>            Title
    --priority <p>         low|normal|high|critical
    --tag <tag>            Tag for dedup/routing
    --channel <c>          Target specific channel (repeatable)

  channel add <name> <type>   Add channel (console|file|http|telegram|discord|slack)
    --url <url>            URL for http/webhook/discord/slack/telegram
    --path <path>          File path for file channel
    --token <token>        Bot token (telegram)
    --chat-id <id>         Chat ID (telegram)

  channel remove <name>    Remove channel
  channel enable <name>    Enable channel
  channel disable <name>   Disable channel
  channels                 List channels

  template add <name> <tmpl>  Add template with {{var}} placeholders
  rule add                   Add routing rule
    --match-tag <tag>      Match tag
    --min-priority <p>     Minimum priority
    --channels <c,c>       Target channels

  quiet-hours <start> <end>  Set quiet hours (0-23)
  stats                    Show stats
  serve                    Start HTTP server
  mcp                      Start MCP server (stdio)
  demo                     Run demo
  help                     Show this help
`;

function parseArgs(args) {
  const parsed = { _: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      parsed.flags[key] = val;
    } else {
      parsed._.push(args[i]);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const notify = new AgentNotify();

  // Default console channel
  notify.addChannel('console', 'console');

  switch (cmd) {
    case 'send': {
      const body = args._[1] || args.flags.body;
      if (!body) { console.error('Error: body required'); process.exit(1); }
      const priMap = { low: 0, normal: 1, high: 2, critical: 3 };
      const result = await notify.send({
        body,
        title: args.flags.title,
        priority: priMap[args.flags.priority] ?? 1,
        tag: args.flags.tag,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'channel': {
      const sub = args._[1];
      if (sub === 'add') {
        const [name, type] = [args._[2], args._[3]];
        const config = { ...args.flags };
        notify.addChannel(name, type, config);
        console.log(`✅ Channel "${name}" (${type}) added`);
      } else if (sub === 'remove') {
        notify.removeChannel(args._[2]);
        console.log(`✅ Channel "${args._[2]}" removed`);
      } else if (sub === 'enable') {
        notify.enableChannel(args._[2]);
        console.log(`✅ Channel "${args._[2]}" enabled`);
      } else if (sub === 'disable') {
        notify.disableChannel(args._[2]);
        console.log(`✅ Channel "${args._[2]}" disabled`);
      }
      break;
    }

    case 'channels': {
      const channels = notify.listChannels();
      if (!channels.length) { console.log('No channels configured'); break; }
      console.log('Channels:');
      for (const ch of channels) {
        console.log(`  ${ch.enabled ? '🟢' : '🔴'} ${ch.name} (${ch.type})`);
      }
      break;
    }

    case 'template': {
      if (args._[1] === 'add') {
        notify.addTemplate(args._[2], args._.slice(3).join(' '));
        console.log(`✅ Template "${args._[2]}" added`);
      }
      break;
    }

    case 'rule': {
      if (args._[1] === 'add') {
        const priMap = { low: 0, normal: 1, high: 2, critical: 3 };
        const channels = (args.flags.channels || '').split(',').filter(Boolean);
        notify.addRule({
          match: (n) => {
            if (args.flags['match-tag'] && n.tag !== args.flags['match-tag']) return false;
            if (args.flags['min-priority'] && n.priority < (priMap[args.flags['min-priority']] ?? 0)) return false;
            return true;
          },
          channels,
        });
        console.log('✅ Rule added');
      }
      break;
    }

    case 'quiet-hours': {
      notify.setQuietHours(Number(args._[1]), Number(args._[2]));
      console.log(`✅ Quiet hours: ${args._[1]}:00 - ${args._[2]}:00`);
      break;
    }

    case 'stats': {
      console.log(JSON.stringify(notify.stats(), null, 2));
      break;
    }

    case 'serve': {
      const { startServer } = await import('./server.mjs');
      startServer(notify);
      break;
    }

    case 'mcp': {
      // MCP mode — just pipe stdin/stdout
      const { default: _ } = await import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      console.log('🚀 agent-notify demo\n');

      notify.addChannel('console', 'console');
      notify.addTemplate('error', '🚨 Error in {{service}}: {{message}}');
      notify.addRule({
        match: n => n.priority >= 2,
        channels: ['console'],
      });

      console.log('Sending notifications at different priorities...\n');
      await notify.low('Background sync completed');
      await sleep(100);
      await notify.info('User logged in', { title: 'Auth Event' });
      await sleep(100);
      await notify.warn('High memory usage detected', { title: 'System Alert', tag: 'memory' });
      await sleep(100);
      await notify.error('Database connection failed', { title: 'Critical Error', tag: 'db' });
      await sleep(100);

      // Template demo
      await notify.send({
        template: 'error',
        data: { service: 'auth-service', message: 'Token expired' },
        priority: Priority.HIGH,
      });
      await sleep(100);

      // Dedup demo
      console.log('\nSending duplicate (should be deduped)...');
      const r1 = await notify.send({ body: 'Same message', tag: 'test' });
      const r2 = await notify.send({ body: 'Same message', tag: 'test' });
      console.log(`  First: ${r1.ok}, Second deduped: ${!r2.ok && r2.reason === 'deduped'}`);

      console.log('\n📊 Stats:', JSON.stringify(notify.stats(), null, 2));
      notify.stop();
      break;
    }

    case 'help':
    default:
      console.log(USAGE);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e.message); process.exit(1); });

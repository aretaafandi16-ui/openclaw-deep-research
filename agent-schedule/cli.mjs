#!/usr/bin/env node
/**
 * agent-schedule CLI
 */

import { AgentSchedule, parseCron, nextCronRun } from './index.mjs';
import { createApp } from './server.mjs';
import { createInterface } from 'node:readline';

const [,, cmd, ...args] = process.argv;

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    }
  }
  return flags;
}

const flags = parseFlags(args);

async function main() {
  switch (cmd) {
    case 'serve': {
      const port = parseInt(flags.port || '3107');
      const { listen } = createApp({ port });
      listen();
      break;
    }

    case 'add':
    case 'schedule': {
      if (!flags.cron) { console.error('Usage: schedule --cron "*/5 * * * *" [--name NAME] [--handler NAME] [--tag TAG]'); process.exit(1); }
      const sched = new AgentSchedule();
      const job = sched.schedule({
        cron: flags.cron,
        name: flags.name,
        handlerName: flags.handler || 'default',
        tags: flags.tag ? [flags.tag] : [],
        timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
        retry: flags.retry ? parseInt(flags.retry) : undefined,
      });
      console.log(JSON.stringify(job, null, 2));
      sched.stop();
      break;
    }

    case 'list': {
      const sched = new AgentSchedule();
      const jobs = sched.list();
      if (jobs.length === 0) { console.log('No jobs scheduled.'); break; }
      for (const j of jobs) {
        const next = j.nextRun ? new Date(j.nextRun).toISOString() : 'N/A';
        console.log(`${j.enabled ? '●' : '○'} ${j.name} [${j.id.slice(0, 8)}] ${j.cron} next=${next} runs=${j.stats.totalRuns}`);
      }
      sched.stop();
      break;
    }

    case 'trigger': {
      const id = args[0];
      if (!id) { console.error('Usage: trigger <job-id>'); process.exit(1); }
      const sched = new AgentSchedule();
      const result = await sched.trigger(id);
      console.log(JSON.stringify(result, null, 2));
      sched.stop();
      break;
    }

    case 'remove':
    case 'unschedule': {
      const id = args[0];
      if (!id) { console.error('Usage: unschedule <job-id>'); process.exit(1); }
      const sched = new AgentSchedule();
      console.log(sched.unschedule(id) ? 'Removed.' : 'Not found.');
      sched.stop();
      break;
    }

    case 'enable': {
      const id = args[0];
      if (!id) { console.error('Usage: enable <job-id>'); process.exit(1); }
      const sched = new AgentSchedule();
      console.log(sched.enable(id) ? 'Enabled.' : 'Not found.');
      sched.stop();
      break;
    }

    case 'disable': {
      const id = args[0];
      if (!id) { console.error('Usage: disable <job-id>'); process.exit(1); }
      const sched = new AgentSchedule();
      console.log(sched.disable(id) ? 'Disabled.' : 'Not found.');
      sched.stop();
      break;
    }

    case 'upcoming': {
      const minutes = parseInt(args[0] || '60');
      const sched = new AgentSchedule();
      const jobs = sched.getUpcoming(minutes);
      if (jobs.length === 0) { console.log(`No jobs in next ${minutes}min`); break; }
      for (const j of jobs) {
        console.log(`${j.name}: ${new Date(j.nextRun).toISOString()}`);
      }
      sched.stop();
      break;
    }

    case 'history': {
      const limit = parseInt(flags.limit || '20');
      const sched = new AgentSchedule();
      const hist = sched.getHistory({ limit });
      if (hist.length === 0) { console.log('No history.'); break; }
      for (const h of hist) {
        console.log(`${h.success ? '✓' : '✗'} ${h.name} ${h.duration || 0}ms ${new Date(h.startTime).toISOString()}`);
      }
      sched.stop();
      break;
    }

    case 'stats': {
      const sched = new AgentSchedule();
      console.log(JSON.stringify(sched.getStats(), null, 2));
      sched.stop();
      break;
    }

    case 'parse': {
      const expr = args[0];
      if (!expr) { console.error('Usage: parse "*/5 * * * *"'); process.exit(1); }
      const parsed = parseCron(expr);
      const next = nextCronRun(parsed, new Date());
      console.log(JSON.stringify({
        minutes: [...parsed.minutes],
        hours: [...parsed.hours],
        daysOfMonth: [...parsed.daysOfMonth],
        months: [...parsed.months],
        daysOfWeek: [...parsed.daysOfWeek],
        nextRun: next ? new Date(next).toISOString() : null,
      }, null, 2));
      break;
    }

    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      console.log('🐋 agent-schedule demo\n');
      const sched = new AgentSchedule();
      sched.onJob('default', async (ctx) => {
        console.log(`  ⏰ Fired: ${ctx.name} at ${new Date().toISOString()}`);
        return 'ok';
      });
      sched.schedule({ cron: '* * * * *', name: 'every-minute', tags: ['demo'] });
      sched.schedule({ cron: '*/5 * * * *', name: 'every-5min', tags: ['demo'] });
      sched.schedule({ cron: '0 * * * *', name: 'hourly', tags: ['demo'] });
      console.log('Jobs:', sched.list().map(j => `${j.name} (${j.cron})`).join(', '));
      console.log('\nTriggering every-minute job...\n');
      await sched.trigger([...sched.entries.keys()][0]);
      console.log('\nUpcoming (60min):', sched.getUpcoming(60).map(j => `${j.name}: ${new Date(j.nextRun).toISOString()}`).join(', '));
      console.log('\nStats:', JSON.stringify(sched.getStats()));
      sched.stop();
      console.log('\nDone!');
      break;
    }

    default:
      console.log(`agent-schedule — zero-dep time-based scheduler for AI agents

Usage: agent-schedule <command> [options]

Commands:
  serve                          Start HTTP dashboard (default port 3107)
  schedule --cron "EXPR"         Schedule a new job
    --name NAME                    Job name
    --handler NAME                 Handler name
    --tag TAG                      Tag for filtering
    --timeout MS                   Execution timeout (default 60000)
    --retry N                      Retry count (default 0)
  list                           List all jobs
  trigger <id>                   Manually trigger a job
  unschedule <id>                Remove a job
  enable <id>                    Enable a job
  disable <id>                   Disable a job
  upcoming [minutes]             Show upcoming jobs (default 60min)
  history [--limit N]            Show run history
  stats                          Show scheduler statistics
  parse "CRON"                   Parse and show next run for cron expression
  demo                           Run interactive demo
  mcp                            Start MCP server (JSON-RPC stdio)

Cron format: minute hour dayOfMonth month dayOfWeek
  */5 * * * *    Every 5 minutes
  0 9 * * *      Every day at 9:00 AM
  0 */2 * * 1-5  Every 2 hours on weekdays
  30 14 1 * *    1st of every month at 2:30 PM`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

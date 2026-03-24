#!/usr/bin/env node
// agent-diag CLI
import { AgentDiag, presets, AlertEngine, Status, Severity } from './index.mjs';

const [,, cmd, ...args] = process.argv;
const diag = new AgentDiag();

const usage = () => `
agent-diag — Diagnostic & Health Monitoring CLI

Commands:
  run <name>       Run a specific check
  run-all          Run all checks
  run-cat <cat>    Run checks by category
  status           Show overall status
  checks           List registered checks
  system           Show system diagnostics
  history [opts]   Show check history (--name, --cat, --limit)
  register <json>  Register a check from JSON
  remove <name>    Unregister a check
  start            Start periodic checking
  demo             Run demo with preset checks
  serve            Start HTTP dashboard (port 3137)
  mcp              Start MCP server (stdio)
  help             Show this help
`;

function flag(name) { return args.includes(name); }
function flagVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

async function main() {
  switch (cmd) {
    case 'run': {
      diag.register(presets.memoryUsage(95));
      diag.register(presets.diskUsage('/'));
      const r = await diag.runCheck(args[0]);
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'run-all': {
      diag.register(presets.memoryUsage(95));
      diag.register(presets.diskUsage('/'));
      diag.register(presets.funcCheck('process', async () => {
        const { heapUsed } = process.memoryUsage();
        return { ok: heapUsed < 500 * 1e6, message: `Heap: ${(heapUsed / 1e6).toFixed(1)}MB` };
      }));
      if (args[0]) diag.register(presets.httpEndpoint(args[0]));
      const results = await diag.runAll();
      for (const r of results) {
        const icon = r.status === 'healthy' ? '✅' : '❌';
        console.log(`${icon} ${r.name}: ${r.message} (${r.durationMs}ms)`);
      }
      break;
    }
    case 'run-cat': {
      diag.register(presets.memoryUsage(95));
      diag.register(presets.diskUsage('/'));
      const results = await diag.runCategory(args[0]);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'status': {
      diag.register(presets.memoryUsage(95));
      diag.register(presets.diskUsage('/'));
      await diag.runAll();
      const s = diag.getStatus();
      const icon = s.overall === 'healthy' ? '🟢' : s.overall === 'unhealthy' ? '🔴' : '🟡';
      console.log(`${icon} Overall: ${s.overall}`);
      console.log(`   Checks: ${s.totalChecks}`);
      for (const [cat, checks] of Object.entries(s.categories)) {
        console.log(`\n  [${cat}]`);
        for (const c of checks) {
          const ci = c.status === 'healthy' ? '✅' : '❌';
          console.log(`    ${ci} ${c.name}: ${c.message || c.status}`);
        }
      }
      break;
    }
    case 'checks': {
      diag.register(presets.memoryUsage(95));
      diag.register(presets.diskUsage('/'));
      const list = diag.listChecks();
      for (const c of list) console.log(`  ${c.name} [${c.category}] every ${c.intervalMs / 1000}s`);
      break;
    }
    case 'system': {
      const sys = diag.collectSystem();
      console.log(`Platform:  ${sys.platform} ${sys.arch}`);
      console.log(`CPUs:      ${sys.cpus.count} × ${sys.cpus.model || 'unknown'}`);
      console.log(`Load:      ${sys.cpus.load1.toFixed(2)} / ${sys.cpus.load5.toFixed(2)} / ${sys.cpus.load15.toFixed(2)}`);
      console.log(`Memory:    ${(sys.memory.used / 1e9).toFixed(1)}G / ${(sys.memory.total / 1e9).toFixed(1)}G (${sys.memory.percent}%)`);
      console.log(`Node:      ${sys.process.version}`);
      console.log(`Uptime:    ${Math.floor(sys.uptime / 3600)}h ${Math.floor((sys.uptime % 3600) / 60)}m`);
      console.log(`Heap:      ${(sys.process.memoryUsage.heapUsed / 1e6).toFixed(1)} MB`);
      console.log(`RSS:       ${(sys.process.memoryUsage.rss / 1e6).toFixed(1)} MB`);
      break;
    }
    case 'history': {
      diag.register(presets.memoryUsage(95));
      await diag.runAll();
      const limit = parseInt(flagVal('--limit') || '20');
      const name = flagVal('--name');
      const cat = flagVal('--cat');
      const hist = diag.getHistory({ name, category: cat, limit });
      for (const h of hist) {
        const icon = h.status === 'healthy' ? '✅' : '❌';
        console.log(`${icon} [${new Date(h.timestamp).toISOString()}] ${h.name}: ${h.message} (${h.durationMs}ms)`);
      }
      break;
    }
    case 'demo': {
      console.log('=== agent-diag Demo ===\n');
      diag.register(presets.memoryUsage(90, { name: 'Memory Check' }));
      diag.register(presets.diskUsage('/', { name: 'Disk Check' }));
      diag.register(presets.funcCheck('Heap Check', async () => {
        const { heapUsed } = process.memoryUsage();
        return { ok: heapUsed < 200 * 1e6, message: `Heap: ${(heapUsed / 1e6).toFixed(1)}MB`, details: { heapUsed } };
      }));
      diag.register(presets.funcCheck('Event Loop', async () => {
        const start = Date.now();
        await new Promise(r => setTimeout(r, 10));
        return { ok: Date.now() - start < 100, message: `Event loop lag: ${Date.now() - start}ms` };
      }));

      // Alert engine demo
      const alerts = new AlertEngine();
      alerts.addRule({ name: 'high-memory', condition: ctx => ctx.memoryPercent > 85, severity: Severity.WARNING, message: 'Memory above 85%', cooldownMs: 5000 });
      alerts.on('alert', a => console.log(`  ⚠️ ALERT: ${a.message}`));

      console.log('Running all checks...\n');
      const results = await diag.runAll();
      for (const r of results) {
        const icon = r.status === 'healthy' ? '✅' : '❌';
        console.log(`${icon} ${r.name}: ${r.message} (${r.durationMs}ms)`);
      }

      const sys = diag.collectSystem();
      alerts.evaluate({ memoryPercent: parseFloat(sys.memory.percent) });

      console.log('\nSystem Info:');
      console.log(`  Memory: ${sys.memory.percent}% used`);
      console.log(`  CPUs: ${sys.cpus.count} × ${sys.cpus.model?.slice(0, 30) || 'unknown'}`);
      console.log(`  Load: ${sys.cpus.load1.toFixed(2)} / ${sys.cpus.load5.toFixed(2)} / ${sys.cpus.load15.toFixed(2)}`);
      console.log(`  Uptime: ${Math.floor(sys.uptime / 3600)}h`);

      const status = diag.getStatus();
      console.log(`\nOverall: ${status.overall}`);
      break;
    }
    case 'serve': await import('./server.mjs'); break;
    case 'mcp': await import('./mcp-server.mjs'); break;
    default: console.log(usage());
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

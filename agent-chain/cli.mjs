#!/usr/bin/env node
/**
 * agent-chain CLI
 */
import { ReasoningChain, ChainManager, PRESETS } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`
agent-chain — Reasoning chain engine for AI agents

Commands:
  create [--name N] [--strategy S]     Create a new chain
  add-step --chain ID --label L ...    Add a step
  react --chain ID --thought T ...     Add ReAct step
  backtrack --chain ID --step ID       Backtrack to step
  evaluate --chain ID --step ID --score N  Score a step
  conclude --chain ID --text T [--confidence C]  Set conclusion
  search --chain ID                    Find best path
  path --chain ID [--step ID]          Get reasoning path
  tree --chain ID                      Show reasoning tree
  list                                 List all chains
  stats [--chain ID]                   Stats
  export --chain ID [--format md]      Export chain
  presets                              List available presets
  demo                                 Run interactive demo
  serve [--port PORT]                  Start HTTP server
  mcp                                  Start MCP server
  help                                 Show this help
  `.trim());
}

function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const manager = new ChainManager();

switch (cmd) {
  case 'create': {
    const strategy = getArg('strategy', 'chain-of-thought');
    const preset = PRESETS[strategy] || {};
    const c = manager.create({ name: getArg('name', 'chain'), strategy,
      maxDepth: +(getArg('maxDepth', preset.maxDepth || 15)),
      confidenceThreshold: +(getArg('threshold', preset.confidenceThreshold ?? 0.7)) });
    console.log(JSON.stringify(c.stats(), null, 2));
    break;
  }
  case 'add-step': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    const step = c.addStep({
      label: getArg('label', ''),
      thought: getArg('thought', ''),
      result: getArg('result', null),
      confidence: +(getArg('confidence', 0.5)),
      parentId: getArg('parent', null)
    });
    console.log(JSON.stringify(step.toJSON(), null, 2));
    break;
  }
  case 'react': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    const step = c.reactStep({
      thought: getArg('thought', ''),
      action: getArg('action', ''),
      observation: getArg('observation', ''),
      confidence: +(getArg('confidence', 0.5))
    });
    console.log(JSON.stringify(step.toJSON(), null, 2));
    break;
  }
  case 'backtrack': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    c.backtrack(getArg('step'));
    console.log(JSON.stringify(c.stats(), null, 2));
    break;
  }
  case 'evaluate': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    c.evaluate(getArg('step'), +(getArg('score', 0)), getArg('notes'));
    console.log(JSON.stringify(c.steps.get(getArg('step')).toJSON(), null, 2));
    break;
  }
  case 'conclude': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    c.conclude(getArg('text', ''), +(getArg('confidence', 0.8)));
    console.log(JSON.stringify({ conclusion: c.conclusion, confidence: c.conclusionConfidence }, null, 2));
    break;
  }
  case 'search': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    const results = c.branchAndBound();
    console.log(JSON.stringify(results.slice(0, 5), null, 2));
    break;
  }
  case 'path': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    console.log(JSON.stringify(c.getPath(getArg('step', null)), null, 2));
    break;
  }
  case 'tree': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    console.log(JSON.stringify(c.getTree(), null, 2));
    break;
  }
  case 'list':
    console.log(JSON.stringify(manager.list(), null, 2));
    break;
  case 'stats': {
    const cid = getArg('chain');
    if (cid) {
      const c = manager.get(cid);
      if (!c) { console.error('Chain not found'); process.exit(1); }
      console.log(JSON.stringify(c.stats(), null, 2));
    } else {
      console.log(JSON.stringify(manager.globalStats(), null, 2));
    }
    break;
  }
  case 'export': {
    const c = manager.get(getArg('chain'));
    if (!c) { console.error('Chain not found'); process.exit(1); }
    const fmt = getArg('format', 'json');
    console.log(fmt === 'markdown' ? c.toMarkdown() : JSON.stringify(c.toJSON(), null, 2));
    break;
  }
  case 'presets':
    console.log(JSON.stringify(PRESETS, null, 2));
    break;
  case 'demo': {
    console.log('🐋 agent-chain demo — Chain of Thought reasoning\n');
    const c = manager.create({ name: 'Demo: Weather Prediction', strategy: 'chain-of-thought' });
    console.log(`Created chain: ${c.id} (${c.name})\n`);

    c.addStep({ label: 'Observe', thought: 'I see dark clouds gathering to the west, wind picking up, and a drop in barometric pressure.',
      result: 'weather_indicators: [clouds, wind, pressure]', confidence: 0.8 });
    console.log('Step 1: Observation (80%)');

    c.addStep({ label: 'Analyze', thought: 'Dark cumulonimbus + dropping pressure + wind = potential thunderstorm system approaching.',
      result: 'system_type: thunderstorm', confidence: 0.75 });
    console.log('Step 2: Analysis (75%)');

    c.addStep({ label: 'Consider Alternatives', thought: 'Could be a cold front passing through without precipitation. However, cloud type and pressure drop suggest moisture-laden system.',
      alternatives: ['cold_front', 'thunderstorm', 'squall_line'], confidence: 0.6 });
    console.log('Step 3: Alternatives (60%)');

    // Branch for different hypotheses
    c.branch(c.history[1], 'thunderstorm_branch');
    c.addStep({ label: 'Thunderstorm Hypothesis', thought: 'If thunderstorm: expect rain within 1-2 hours, possible lightning, temperature drop.',
      result: { prediction: 'thunderstorm', confidence: 0.7, eta: '1-2h' }, confidence: 0.7 });

    c.branch(c.history[1], 'cold_front_branch');
    c.addStep({ label: 'Cold Front Hypothesis', thought: 'If cold front: expect temperature drop, wind shift, possibly no rain.',
      result: { prediction: 'cold_front', confidence: 0.4, eta: '3-6h' }, confidence: 0.4 });

    c.evaluate(c.history[2], 0.8, 'Cloud type strongly supports thunderstorm');
    c.evaluate(c.history[3], 0.3, 'Less likely given cloud morphology');

    c.conclude('Thunderstorm likely within 1-2 hours. Recommend seeking shelter. Temperature will drop 5-10°F.', 0.75);

    console.log('\n📊 Stats:', JSON.stringify(c.stats(), null, 2));
    console.log('\n📝 Markdown:\n');
    console.log(c.toMarkdown());

    const best = c.branchAndBound();
    console.log('\n🔍 Best paths:', JSON.stringify(best.slice(0, 3), null, 2));
    break;
  }
  case 'serve':
    import('./server.mjs');
    break;
  case 'mcp':
    import('./mcp-server.mjs');
    break;
  case 'help':
  default:
    usage();
}

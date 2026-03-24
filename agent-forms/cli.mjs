#!/usr/bin/env node
// agent-forms/cli.mjs — Full CLI for agent-forms
import { FormEngine } from './index.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const USAGE = `
agent-forms — Form & survey engine for AI agents

Usage: agent-forms <command> [options]

Commands:
  create <name>           Create a new form
  list                    List all forms
  get <id>                Get form details
  delete <id>             Delete a form
  add-field <formId>      Add a field to a form (JSON via stdin)
  remove-field <formId> <field>
  start <formId>          Start a new response
  fill <formId> <respId> <field> <value>
  validate <formId> <respId>
  submit <formId> <respId>
  progress <formId> <respId>
  next <formId> <respId>  Get next field to fill (NL prompt)
  responses <formId>      List responses
  stats <formId>          Response statistics
  aggregate <formId> <field>
  export-csv <formId>     Export responses as CSV
  export-json <formId>    Export as JSON
  demo                    Run interactive demo
  serve [port]            Start HTTP server
  mcp                     Start MCP server
`;

const PERSIST = process.env.AGENT_FORMS_DATA || '/tmp/agent-forms-data';

function getEngine() {
  return new FormEngine({ persistPath: PERSIST });
}

const [,, cmd, ...args] = process.argv;

async function main() {
  const engine = getEngine();

  switch (cmd) {
    case 'create': {
      if (!args[0]) { console.error('Usage: agent-forms create <name>'); process.exit(1); }
      const fields = [];
      if (args.length > 1) {
        for (let i = 1; i < args.length; i++) {
          const parts = args[i].split(':');
          fields.push({ name: parts[0], type: parts[1] || 'text', validation: parts[2] === 'required' ? { required: true } : {} });
        }
      }
      const form = engine.createForm({ name: args[0], fields: fields.length ? fields : [{ name: 'default', type: 'text' }] });
      console.log(JSON.stringify({ id: form.id, name: form.name, fields: form.fields.length }));
      break;
    }
    case 'list': {
      const forms = engine.listForms();
      if (forms.length === 0) { console.log('No forms.'); break; }
      for (const f of forms) console.log(`${f.id}\t${f.name}\t${f.fields.length} fields`);
      break;
    }
    case 'get': {
      if (!args[0]) { console.error('Usage: agent-forms get <id>'); process.exit(1); }
      console.log(JSON.stringify(engine.getForm(args[0]).toJSON(), null, 2));
      break;
    }
    case 'delete': {
      if (!args[0]) { console.error('Usage: agent-forms delete <id>'); process.exit(1); }
      engine.deleteForm(args[0]);
      console.log('Deleted.');
      break;
    }
    case 'add-field': {
      if (!args[0]) { console.error('Usage: agent-forms add-field <formId>'); process.exit(1); }
      const def = JSON.parse(readFileSync(0, 'utf8'));
      const field = engine.addField(args[0], def);
      console.log(JSON.stringify(field.toJSON(), null, 2));
      break;
    }
    case 'remove-field': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms remove-field <formId> <field>'); process.exit(1); }
      engine.removeField(args[0], args[1]);
      console.log('Removed.');
      break;
    }
    case 'start': {
      if (!args[0]) { console.error('Usage: agent-forms start <formId>'); process.exit(1); }
      const resp = engine.startResponse(args[0]);
      console.log(JSON.stringify({ id: resp.id, formId: resp.formId, status: resp.status }));
      break;
    }
    case 'fill': {
      if (args.length < 4) { console.error('Usage: agent-forms fill <formId> <respId> <field> <value>'); process.exit(1); }
      engine.fillField(args[0], args[1], args[2], args[3]);
      console.log('Filled.');
      break;
    }
    case 'validate': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms validate <formId> <respId>'); process.exit(1); }
      const result = engine.validateResponse(args[0], args[1]);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'submit': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms submit <formId> <respId>'); process.exit(1); }
      const result = engine.submitResponse(args[0], args[1]);
      console.log(JSON.stringify(result.success ? { success: true, response: result.response.toJSON() } : result, null, 2));
      break;
    }
    case 'progress': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms progress <formId> <respId>'); process.exit(1); }
      console.log(JSON.stringify(engine.getProgress(args[0], args[1]), null, 2));
      break;
    }
    case 'next': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms next <formId> <respId>'); process.exit(1); }
      const next = engine.getNextField(args[0], args[1]);
      if (!next) { console.log('Form complete! All required fields filled.'); }
      else { console.log(next.prompt); }
      break;
    }
    case 'responses': {
      if (!args[0]) { console.error('Usage: agent-forms responses <formId>'); process.exit(1); }
      const resps = engine.getFormResponses(args[0]);
      for (const r of resps) console.log(`${r.id}\t${r.status}\t${r.submittedAt || 'draft'}`);
      break;
    }
    case 'stats': {
      if (!args[0]) { console.error('Usage: agent-forms stats <formId>'); process.exit(1); }
      console.log(JSON.stringify(engine.getResponseStats(args[0]), null, 2));
      break;
    }
    case 'aggregate': {
      if (!args[0] || !args[1]) { console.error('Usage: agent-forms aggregate <formId> <field>'); process.exit(1); }
      console.log(JSON.stringify(engine.aggregate(args[0], args[1]), null, 2));
      break;
    }
    case 'export-csv': {
      if (!args[0]) { console.error('Usage: agent-forms export-csv <formId>'); process.exit(1); }
      console.log(engine.exportCSV(args[0]));
      break;
    }
    case 'export-json': {
      if (!args[0]) { console.error('Usage: agent-forms export-json <formId>'); process.exit(1); }
      console.log(JSON.stringify(engine.exportJSON(args[0]), null, 2));
      break;
    }
    case 'demo': {
      console.log('=== agent-forms Demo ===\n');
      const form = engine.createForm({
        name: 'User Feedback Survey',
        description: 'Quick feedback collection',
        fields: [
          { name: 'name', type: 'text', label: 'Your Name', validation: { required: true }, order: 0 },
          { name: 'email', type: 'email', label: 'Email', validation: { required: true }, order: 1 },
          { name: 'rating', type: 'rating', label: 'Overall Rating', validation: { required: true, min: 1, max: 5 }, order: 2 },
          { name: 'category', type: 'select', label: 'Category', options: ['Bug', 'Feature', 'Question', 'Other'], validation: { required: true }, order: 3 },
          { name: 'bug_desc', type: 'textarea', label: 'Bug Description', conditional: { field: 'category', op: 'eq', value: 'Bug' }, order: 4 },
          { name: 'feature_desc', type: 'textarea', label: 'Feature Request', conditional: { field: 'category', op: 'eq', value: 'Feature' }, order: 5 },
          { name: 'would_recommend', type: 'boolean', label: 'Would you recommend us?', order: 6 },
          { name: 'nps', type: 'slider', label: 'NPS Score (0-10)', validation: { min: 0, max: 10 }, conditional: { field: 'would_recommend', op: 'eq', value: true }, order: 7 },
        ],
        settings: { submitText: 'Send Feedback', successMessage: 'Thank you for your feedback!' },
      });
      console.log(`Created form: ${form.name} (${form.id})\n`);

      // Simulate a response
      const resp = engine.startResponse(form.id);
      console.log(`Started response: ${resp.id}\n`);

      // Walk through fields
      let next;
      while ((next = engine.getNextField(form.id, resp.id))) {
        console.log(`Next: ${next.prompt}\n`);
        // Auto-fill for demo
        const vals = { name: 'Alice', email: 'alice@example.com', rating: 4, category: 'Feature', feature_desc: 'Dark mode please!', would_recommend: true, nps: 8 };
        const val = vals[next.field.name];
        if (val !== undefined) {
          engine.fillField(form.id, resp.id, next.field.name, val);
          console.log(`  → Filled "${next.field.name}" = ${JSON.stringify(val)}\n`);
        }
      }

      // Validate and submit
      const { valid, errors } = engine.validateResponse(form.id, resp.id);
      console.log(`Validation: ${valid ? 'PASS ✓' : 'FAIL ✗'}`);
      if (!valid) console.log('Errors:', JSON.stringify(errors));

      if (valid) {
        const sub = engine.submitResponse(form.id, resp.id);
        console.log(`Submitted: ${sub.success}`);
      }

      // Progress
      const progress = engine.getProgress(form.id, resp.id);
      console.log(`\nProgress: ${progress.filled}/${progress.total} (${progress.percent}%)`);

      // Another response (bug report)
      console.log('\n--- Second response (Bug report) ---');
      const r2 = engine.startResponse(form.id);
      engine.fillFields(form.id, r2.id, { name: 'Bob', email: 'bob@test.com', rating: 2, category: 'Bug', bug_desc: 'App crashes on login', would_recommend: false });
      const v2 = engine.validateResponse(form.id, r2.id);
      if (v2.valid) engine.submitResponse(form.id, r2.id);

      // Stats
      console.log('\n--- Stats ---');
      console.log(JSON.stringify(engine.getResponseStats(form.id), null, 2));

      // Aggregate
      console.log('\n--- Rating Aggregation ---');
      console.log(JSON.stringify(engine.aggregate(form.id, 'rating'), null, 2));

      console.log('\n--- Category Distribution ---');
      console.log(JSON.stringify(engine.aggregate(form.id, 'category'), null, 2));

      // Export
      console.log('\n--- CSV Export ---');
      console.log(engine.exportCSV(form.id));

      // Engine stats
      console.log('\n--- Engine Stats ---');
      console.log(JSON.stringify(engine.stats(), null, 2));

      break;
    }
    case 'serve': {
      const { default: startServer } = await import('./server.mjs');
      startServer(parseInt(args[0]) || 3127);
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

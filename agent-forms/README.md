# agent-forms

Zero-dependency form & survey engine for AI agents. Schema validation, conditional logic, multi-step wizards, and structured data collection — all in pure Node.js.

## Features

- **Schema-based forms** with 17 field types (text, email, number, select, multiselect, boolean, date, rating, slider, computed, etc.)
- **12+ validators** — required, min/max, pattern, enum, email, url, phone, minLength/maxLength, minItems/maxItems, custom functions
- **Conditional fields** — show/hide based on other field values with `eq`, `neq`, `gt`, `lt`, `in`, `nin`, `contains`, `exists`, `empty`, `regex` operators
- **Boolean logic** — `and`, `or`, `not` composition for complex conditions
- **Multi-step wizards** — split forms into sequential steps with per-step validation
- **Natural language bridge** — `getNextField()` returns a human-readable prompt for conversational form filling
- **Value transforms** — trim, lowercase, uppercase, number, boolean, or custom functions
- **Computed fields** — auto-calculated from other field values
- **Data aggregation** — numeric stats (mean, median, stddev, percentiles) and categorical distributions
- **CSV/JSON export** — full response data export
- **JSONL persistence** — event log + periodic snapshots, survives restarts
- **EventEmitter** — real-time events for all operations

## Quick Start

```js
import { FormEngine } from './index.mjs';

const engine = new FormEngine();

// Create a form
const form = engine.createForm({
  name: 'User Survey',
  fields: [
    { name: 'name', type: 'text', label: 'Your Name', validation: { required: true } },
    { name: 'email', type: 'email', label: 'Email', validation: { required: true } },
    { name: 'rating', type: 'rating', label: 'Rating', validation: { min: 1, max: 5 } },
    { name: 'state', type: 'text', label: 'State', conditional: { field: 'country', op: 'eq', value: 'US' } },
  ]
});

// Start a response and fill conversationally
const resp = engine.startResponse(form.id);
engine.fillField(form.id, resp.id, 'name', 'Alice');
engine.fillField(form.id, resp.id, 'email', 'alice@test.com');

// Get next field (NL-style prompt)
const next = engine.getNextField(form.id, resp.id);
// → { field: {...}, prompt: 'Rating (required): Rate from 1 to 5', index: 2, total: 3 }

// Validate & submit
const { valid } = engine.validateResponse(form.id, resp.id);
if (valid) engine.submitResponse(form.id, resp.id);

// Aggregate results
const stats = engine.aggregate(form.id, 'rating');
// → { type: 'numeric', mean: 4.2, min: 1, max: 5, ... }
```

## Field Types

| Type | Description |
|------|-------------|
| `text` | Plain text input |
| `number` | Numeric value |
| `email` | Email with validation |
| `phone` | Phone number |
| `url` | URL with validation |
| `password` | Masked text |
| `textarea` | Multi-line text |
| `select` | Single choice from options |
| `multiselect` | Multiple choices |
| `radio` | Radio button group |
| `checkbox` | Multi-select checkboxes |
| `boolean` | Yes/No toggle |
| `date` | Date input |
| `datetime` | Date + time |
| `rating` | 1-5 star rating |
| `slider` | Range slider |
| `computed` | Auto-calculated value |
| `hidden` | Not shown to user |

## Conditional Fields

```js
{ name: 'state', conditional: { field: 'country', op: 'eq', value: 'US' } }

// Boolean logic
{ name: 'x', conditional: {
  and: [
    { field: 'role', op: 'eq', value: 'admin' },
    { or: [{ field: 'plan', op: 'in', value: ['pro', 'enterprise'] }, { field: 'verified', op: 'eq', value: true }] }
  ]
}}
```

**Operators:** `eq`/`==`, `neq`/`!=`, `gt`/`>`, `gte`/`>=`, `lt`/`<`, `lte`/`<=`, `in`, `nin`, `contains`, `exists`, `empty`, `regex`

## Multi-Step Wizards

```js
const form = engine.createForm({
  name: 'Registration',
  fields: [
    { name: 'email', type: 'email', validation: { required: true } },
    { name: 'password', type: 'password', validation: { required: true } },
    { name: 'name', type: 'text', validation: { required: true } },
    { name: 'bio', type: 'textarea' },
  ],
  steps: [
    { name: 'Account', fields: ['email', 'password'] },
    { name: 'Profile', fields: ['name', 'bio'] },
  ]
});

const resp = engine.startResponse(form.id);
engine.validateStep(form.id, resp.id, 0); // validate current step
engine.getCurrentStep(form.id, resp.id);   // { step: 0, totalSteps: 2 }
```

## Data Aggregation

```js
// Numeric fields → stats
engine.aggregate(formId, 'rating');
// { type: 'numeric', count: 42, mean: 3.8, median: 4, min: 1, max: 5, stddev: 1.2 }

// Categorical fields → distribution
engine.aggregate(formId, 'category');
// { type: 'categorical', count: 42, distribution: { 'Bug': 15, 'Feature': 20, 'Other': 7 } }
```

## Quick Form Builder

```js
const form = FormEngine.quickForm('Contact', [
  'name',
  { name: 'email', type: 'email', validation: { required: true } },
  { name: 'age', type: 'number', validation: { min: 0, max: 150 } },
]);
```

## Events

```js
engine.on('form:create', (form) => { ... });
engine.on('response:start', ({ formId, response }) => { ... });
engine.on('response:fill', ({ formId, responseId, fieldName, value }) => { ... });
engine.on('response:submit', ({ formId, responseId, response }) => { ... });
engine.on('response:submit-failed', ({ formId, responseId, errors }) => { ... });
```

## CLI

```bash
node cli.mjs create "User Survey"          # Create a form
node cli.mjs list                           # List all forms
node cli.mjs start <formId>                 # Start a response
node cli.mjs fill <formId> <respId> name Alice
node cli.mjs next <formId> <respId>         # Get next field prompt
node cli.mjs validate <formId> <respId>     # Validate
node cli.mjs submit <formId> <respId>       # Submit
node cli.mjs stats <formId>                 # Response stats
node cli.mjs aggregate <formId> rating      # Aggregate field
node cli.mjs export-csv <formId>            # CSV export
node cli.mjs export-json <formId>           # JSON export
node cli.mjs demo                           # Run full demo
node cli.mjs serve 3127                     # HTTP server
node cli.mjs mcp                            # MCP server
```

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/forms` | List forms |
| POST | `/api/forms` | Create form |
| GET | `/api/forms/:id` | Get form |
| POST | `/api/forms/:id/delete` | Delete form |
| POST | `/api/forms/:id/start` | Start response |
| POST | `/api/forms/:id/responses/:rid/fill` | Fill field |
| GET | `/api/forms/:id/responses/:rid/next` | Next field prompt |
| GET | `/api/forms/:id/responses/:rid/validate` | Validate |
| POST | `/api/forms/:id/responses/:rid/submit` | Submit |
| GET | `/api/forms/:id/responses/:rid/progress` | Progress |
| GET | `/api/forms/:id/responses` | List responses |
| GET | `/api/forms/:id/aggregate/:field` | Aggregate |
| GET | `/api/forms/:id/export.csv` | CSV export |
| GET | `/api/forms/:id/export.json` | JSON export |
| GET | `/api/stats` | Engine stats |

Dashboard: `http://localhost:3127`

## MCP Server (14 tools)

| Tool | Description |
|------|-------------|
| `forms_create` | Create form with fields |
| `forms_get` | Get form by ID |
| `forms_list` | List forms |
| `forms_delete` | Delete form |
| `forms_add_field` | Add field to form |
| `forms_start` | Start response |
| `forms_fill` | Fill field value |
| `forms_next` | Get next field (NL prompt) |
| `forms_validate` | Validate response |
| `forms_submit` | Submit response |
| `forms_progress` | Get fill progress |
| `forms_aggregate` | Aggregate field data |
| `forms_export` | Export CSV/JSON |
| `forms_stats` | Engine statistics |

## License

MIT

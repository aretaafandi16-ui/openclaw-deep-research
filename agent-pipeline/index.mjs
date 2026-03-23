/**
 * agent-pipeline — Zero-dependency pipeline orchestrator for AI agents
 * 
 * Features:
 * - Composable step chains with input/output mapping
 * - Conditional branching (if/else/switch)
 * - Parallel execution of independent steps
 * - Retry with exponential backoff
 * - Error handlers and fallback steps
 * - Timeout per step and global
 * - Middleware hooks (before/after/finally)
 * - Pipeline composition (pipelines as steps)
 * - Dry-run mode
 * - Event-driven progress tracking
 * - JSON-serializable pipeline definitions
 * - MCP server compatibility
 */

import { EventEmitter } from 'node:events';

// ── Step Status ──
const Status = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  TIMEOUT: 'timeout',
  RETRYING: 'retrying',
};

// ── Built-in step types ──
const StepType = {
  TASK: 'task',           // Run an async function
  TRANSFORM: 'transform',  // Map context data
  CONDITION: 'condition',  // Branch based on predicate
  PARALLEL: 'parallel',    // Run steps concurrently
  PIPELINE: 'pipeline',    // Nested pipeline
  DELAY: 'delay',          // Wait N ms
  LOG: 'log',              // Log a message
  SET: 'set',              // Set context values
  ASSERT: 'assert',        // Assert condition or fail
};

class PipelineError extends Error {
  constructor(message, stepName, cause) {
    super(message);
    this.name = 'PipelineError';
    this.stepName = stepName;
    this.cause = cause;
  }
}

class StepTimeoutError extends PipelineError {
  constructor(stepName, timeoutMs) {
    super(`Step "${stepName}" timed out after ${timeoutMs}ms`, stepName);
    this.name = 'StepTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

class RetryExhaustedError extends PipelineError {
  constructor(stepName, attempts, lastError) {
    super(`Step "${stepName}" failed after ${attempts} attempts`, stepName, lastError);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
  }
}

// ── Utility: withTimeout ──
function withTimeout(promise, ms, stepName) {
  if (!ms || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new StepTimeoutError(stepName, ms)), ms);
    }),
  ]);
}

// ── Utility: sleep ──
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Retry logic ──
async function withRetry(fn, opts = {}) {
  const { maxAttempts = 3, backoffMs = 1000, backoffMultiplier = 2, jitter = true } = opts;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        let delay = backoffMs * Math.pow(backoffMultiplier, attempt - 1);
        if (jitter) delay *= (0.5 + Math.random() * 0.5);
        await sleep(delay);
      }
    }
  }
  throw new RetryExhaustedError(fn.name || 'anonymous', maxAttempts, lastError);
}

// ── Pipeline class ──
class Pipeline extends EventEmitter {
  constructor(name, opts = {}) {
    super();
    this.name = name;
    this.steps = [];
    this.globalTimeoutMs = opts.globalTimeoutMs || 0;
    this.middleware = { before: [], after: [], finally: [], onError: [] };
    this.dryRun = opts.dryRun || false;
    this.context = opts.context || {};
  }

  // ── Builder: add steps ──
  add(name, handler, opts = {}) {
    this.steps.push({
      name,
      type: opts.type || StepType.TASK,
      handler,
      opts: {
        timeoutMs: opts.timeoutMs || 0,
        retry: opts.retry || null, // { maxAttempts, backoffMs, backoffMultiplier }
        onError: opts.onError || null, // fallback handler
        skipIf: opts.skipIf || null,   // (ctx) => boolean
        transform: opts.transform || null, // (result, ctx) => newCtx
        dependsOn: opts.dependsOn || [],   // step names this depends on
        ...opts,
      },
    });
    return this;
  }

  transform(name, fn, opts = {}) {
    return this.add(name, fn, { ...opts, type: StepType.TRANSFORM });
  }

  condition(name, predicate, trueBranch, falseBranch = null, opts = {}) {
    return this.add(name, { predicate, trueBranch, falseBranch }, { ...opts, type: StepType.CONDITION });
  }

  parallel(name, steps, opts = {}) {
    return this.add(name, steps, { ...opts, type: StepType.PARALLEL });
  }

  pipeline(name, subPipeline, opts = {}) {
    return this.add(name, subPipeline, { ...opts, type: StepType.PIPELINE });
  }

  delay(name, ms, opts = {}) {
    return this.add(name, ms, { ...opts, type: StepType.DELAY });
  }

  log(name, message, opts = {}) {
    return this.add(name, message, { ...opts, type: StepType.LOG });
  }

  set(name, values, opts = {}) {
    return this.add(name, values, { ...opts, type: StepType.SET });
  }

  assert(name, predicate, message, opts = {}) {
    return this.add(name, { predicate, message }, { ...opts, type: StepType.ASSERT });
  }

  // ── Middleware ──
  before(fn) { this.middleware.before.push(fn); return this; }
  after(fn) { this.middleware.after.push(fn); return this; }
  finally(fn) { this.middleware.finally.push(fn); return this; }
  onError(fn) { this.middleware.onError.push(fn); return this; }

  // ── Run ──
  async run(initialContext = {}) {
    const ctx = { ...this.context, ...initialContext };
    const result = {
      name: this.name,
      status: Status.SUCCESS,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: 0,
      steps: [],
      context: ctx,
      error: null,
    };

    const startTime = Date.now();
    const checkGlobalTimeout = () => {
      if (this.globalTimeoutMs > 0 && (Date.now() - startTime) > this.globalTimeoutMs) {
        throw new PipelineError(`Pipeline "${this.name}" timed out after ${this.globalTimeoutMs}ms`, this.name);
      }
    };

    try {
      // Run before middleware
      for (const mw of this.middleware.before) {
        await mw(ctx);
      }

      for (const step of this.steps) {
        checkGlobalTimeout();
        // Enforce global timeout at step level
        if (this.globalTimeoutMs > 0) {
          const remaining = this.globalTimeoutMs - (Date.now() - startTime);
          if (remaining <= 0) {
            throw new PipelineError(`Pipeline "${this.name}" timed out after ${this.globalTimeoutMs}ms`, this.name);
          }
          if (!step.opts.timeoutMs || remaining < step.opts.timeoutMs) {
            step.opts.timeoutMs = remaining;
          }
        }
        const stepResult = await this._runStep(step, ctx, startTime);
        result.steps.push(stepResult);

        if (stepResult.status === Status.FAILED || stepResult.status === Status.TIMEOUT) {
          result.status = Status.FAILED;
          result.error = stepResult.error;
          
          // Run error middleware
          for (const mw of this.middleware.onError) {
            await mw(stepResult, ctx);
          }
          break;
        }

        // Apply transform if step succeeded
        if (stepResult.status === Status.SUCCESS && step.opts.transform) {
          Object.assign(ctx, step.opts.transform(stepResult.output, ctx));
        }
      }

      // Run after middleware
      for (const mw of this.middleware.after) {
        await mw(result, ctx);
      }
    } catch (err) {
      result.status = Status.FAILED;
      result.error = { message: err.message, stack: err.stack, name: err.name };
      this.emit('error', err, ctx);
    } finally {
      for (const mw of this.middleware.finally) {
        await mw(result, ctx);
      }
      result.finishedAt = Date.now();
      result.durationMs = result.finishedAt - result.startedAt;
    }

    this.emit('done', result);
    return result;
  }

  async _runStep(step, ctx, pipelineStart) {
    const stepResult = {
      name: step.name,
      type: step.type,
      status: Status.PENDING,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: 0,
      output: null,
      error: null,
      attempts: 0,
    };

    // Check skip condition
    if (step.opts.skipIf && step.opts.skipIf(ctx)) {
      stepResult.status = Status.SKIPPED;
      stepResult.finishedAt = Date.now();
      stepResult.durationMs = stepResult.finishedAt - stepResult.startedAt;
      this.emit('step', stepResult);
      return stepResult;
    }

    // Check dependencies
    if (step.opts.dependsOn?.length) {
      // Dependencies are checked via context._stepResults
      for (const dep of step.opts.dependsOn) {
        const depResult = ctx._stepResults?.[dep];
        if (!depResult || depResult.status !== Status.SUCCESS) {
          stepResult.status = Status.SKIPPED;
          stepResult.error = { message: `Dependency "${dep}" not satisfied` };
          stepResult.finishedAt = Date.now();
          stepResult.durationMs = stepResult.finishedAt - stepResult.startedAt;
          this.emit('step', stepResult);
          return stepResult;
        }
      }
    }

    stepResult.status = Status.RUNNING;
    this.emit('stepStart', stepResult);

    const executeStep = async (attempt) => {
      stepResult.attempts = attempt;
      if (attempt > 1) {
        stepResult.status = Status.RETRYING;
        this.emit('step', stepResult);
      }

      // Global timeout check
      if (this.globalTimeoutMs > 0 && (Date.now() - pipelineStart) > this.globalTimeoutMs) {
        throw new PipelineError('Global timeout exceeded', step.name);
      }

      switch (step.type) {
        case StepType.TASK:
          return await step.handler(ctx, { dryRun: this.dryRun });
        case StepType.TRANSFORM: {
          const output = await step.handler(ctx);
          // Transforms auto-merge their output into context
          if (output && typeof output === 'object') Object.assign(ctx, output);
          return output;
        }
        case StepType.CONDITION: {
          const { predicate, trueBranch, falseBranch } = step.handler;
          const branch = await predicate(ctx) ? trueBranch : falseBranch;
          if (!branch) return null;
          if (typeof branch === 'function') return await branch(ctx);
          // Branch is a pipeline
          return await branch.run(ctx);
        }
        case StepType.PARALLEL: {
          const parallelSteps = step.handler;
          const promises = parallelSteps.map(s => this._runStep(s, { ...ctx }, pipelineStart));
          const results = await Promise.allSettled(promises);
          const outputs = results.map((r, i) => {
            if (r.status === 'rejected') {
              return { name: parallelSteps[i].name, status: Status.FAILED, error: r.reason?.message };
            }
            return r.value;
          });
          const anyFailed = outputs.some(o => o.status === Status.FAILED || o.status === Status.TIMEOUT);
          if (anyFailed && !step.opts.allowPartialFailure) {
            throw new PipelineError(`Parallel step "${step.name}" had failures`, step.name);
          }
          return outputs;
        }
        case StepType.PIPELINE: {
          const subPipeline = step.handler;
          const subResult = await subPipeline.run(ctx);
          if (subResult.status === Status.FAILED) {
            throw new PipelineError(`Sub-pipeline "${subPipeline.name}" failed: ${subResult.error?.message}`, step.name);
          }
          return subResult;
        }
        case StepType.DELAY:
          await sleep(step.handler);
          return { delayed: step.handler };
        case StepType.LOG:
          this.emit('log', { step: step.name, message: step.handler, ctx });
          return { logged: step.handler };
        case StepType.SET:
          Object.assign(ctx, step.handler);
          return step.handler;
        case StepType.ASSERT: {
          const { predicate, message } = step.handler;
          const ok = typeof predicate === 'function' ? await predicate(ctx) : predicate;
          if (!ok) throw new PipelineError(message || `Assertion failed in "${step.name}"`, step.name);
          return { asserted: true };
        }
        default:
          throw new PipelineError(`Unknown step type: ${step.type}`, step.name);
      }
    };

    try {
      let output;
      if (step.opts.retry) {
        output = await withRetry(executeStep, step.opts.retry);
      } else {
        output = await withTimeout(
          executeStep(1),
          step.opts.timeoutMs,
          step.name
        );
      }
      stepResult.status = Status.SUCCESS;
      stepResult.output = output;

      // Track step result in context for dependencies
      ctx._stepResults = ctx._stepResults || {};
      ctx._stepResults[step.name] = stepResult;
    } catch (err) {
      if (err instanceof StepTimeoutError) {
        stepResult.status = Status.TIMEOUT;
      } else {
        stepResult.status = Status.FAILED;
      }
      stepResult.error = { message: err.message, stack: err.stack, name: err.name };

      // Try fallback
      if (step.opts.onError) {
        try {
          stepResult.output = await step.opts.onError(err, ctx);
          stepResult.status = Status.SUCCESS;
          stepResult.error = null;
        } catch (fallbackErr) {
          stepResult.error = { message: fallbackErr.message, stack: fallbackErr.stack, name: fallbackErr.name };
        }
      }
    }

    stepResult.finishedAt = Date.now();
    stepResult.durationMs = stepResult.finishedAt - stepResult.startedAt;
    this.emit('step', stepResult);
    return stepResult;
  }

  // ── Serialization ──
  toJSON() {
    return {
      name: this.name,
      steps: this.steps.map(s => ({
        name: s.name,
        type: s.type,
        opts: { ...s.opts, handler: undefined },
      })),
      globalTimeoutMs: this.globalTimeoutMs,
    };
  }

  // ── Static: from JSON definition ──
  static fromJSON(def, handlers = {}) {
    const p = new Pipeline(def.name, { globalTimeoutMs: def.globalTimeoutMs });
    for (const step of def.steps) {
      const handler = handlers[step.name] || (() => { throw new Error(`No handler for "${step.name}"`); });
      p.add(step.name, handler, step.opts || {});
    }
    return p;
  }

  // ── Static: compose (merge pipelines) ──
  static compose(name, pipelines, opts = {}) {
    const p = new Pipeline(name, opts);
    for (const sub of pipelines) {
      p.pipeline(sub.name, sub);
    }
    return p;
  }
}

// ── Factory helpers ──
function pipeline(name, opts) { return new Pipeline(name, opts); }

export {
  Pipeline,
  PipelineError,
  StepTimeoutError,
  RetryExhaustedError,
  Status,
  StepType,
  pipeline,
  withRetry,
  withTimeout,
};

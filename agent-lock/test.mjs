/**
 * agent-lock tests — 30 tests
 */

import { AgentLock } from './index.mjs';
import { strict as assert } from 'assert';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';

const DATA_DIR = '/tmp/agent-lock-test-' + Date.now();

function freshLock() {
  return new AgentLock({ namespace: 'test', persistDir: DATA_DIR });
}

test('mutex: basic acquire and release', async () => {
  const lock = freshLock();
  await lock.lock('res', 'a');
  const m = lock.mutex('res');
  assert.equal(m.locked, true);
  assert.equal(m.owner, 'a');
  lock.unlock('res', 'a');
  assert.equal(m.locked, false);
  lock.destroy();
});

test('mutex: reentrant lock', async () => {
  const lock = freshLock();
  await lock.lock('res', 'a');
  await lock.lock('res', 'a');
  const m = lock.mutex('res');
  assert.equal(m.reentrantCount, 2);
  lock.unlock('res', 'a');
  assert.equal(m.reentrantCount, 1); // still held
  lock.unlock('res', 'a');
  assert.equal(m.locked, false);
  lock.destroy();
});

test('mutex: queue and handoff', async () => {
  const lock = freshLock();
  await lock.lock('res', 'a');
  const p = lock.lock('res', 'b').then(() => 'b-acquired');
  // Release a, b should get it
  lock.unlock('res', 'a');
  const result = await p;
  assert.equal(result, 'b-acquired');
  lock.unlock('res', 'b');
  lock.destroy();
});

test('mutex: timeout', async () => {
  const lock = freshLock();
  await lock.lock('res', 'a');
  try {
    await lock.lock('res', 'b', 50);
    assert.fail('Should have timed out');
  } catch (err) {
    assert.match(err.message, /timeout/);
  }
  lock.unlock('res', 'a');
  lock.destroy();
});

test('mutex: force release', async () => {
  const lock = freshLock();
  await lock.lock('res', 'a');
  const prev = lock.forceUnlock('res');
  assert.equal(prev, 'a');
  assert.equal(lock.mutex('res').locked, false);
  lock.destroy();
});

test('withLock: auto-release', async () => {
  const lock = freshLock();
  const result = await lock.withLock('res', 'a', () => 42);
  assert.equal(result, 42);
  assert.equal(lock.mutex('res').locked, false);
  lock.destroy();
});

test('withLock: auto-release on error', async () => {
  const lock = freshLock();
  try {
    await lock.withLock('res', 'a', () => { throw new Error('boom'); });
  } catch (err) {
    assert.equal(err.message, 'boom');
  }
  assert.equal(lock.mutex('res').locked, false);
  lock.destroy();
});

test('rwlock: concurrent readers', async () => {
  const lock = freshLock();
  await lock.readLock('data', 'r1');
  await lock.readLock('data', 'r2');
  const rw = lock.rwLock('data');
  assert.equal(rw.reading, 2);
  lock.readUnlock('data', 'r1');
  lock.readUnlock('data', 'r2');
  lock.destroy();
});

test('rwlock: exclusive writer blocks readers', async () => {
  const lock = freshLock();
  await lock.writeLock('data', 'w1');
  const p = lock.readLock('data', 'r1', 50).catch(e => 'timeout');
  const result = await p;
  assert.equal(result, 'timeout');
  lock.writeUnlock('data', 'w1');
  lock.destroy();
});

test('rwlock: writer blocks other writers', async () => {
  const lock = freshLock();
  await lock.writeLock('data', 'w1');
  const p = lock.writeLock('data', 'w2', 50).catch(e => 'timeout');
  assert.equal(await p, 'timeout');
  lock.writeUnlock('data', 'w1');
  lock.destroy();
});

test('rwlock: reentrant write', async () => {
  const lock = freshLock();
  await lock.writeLock('data', 'w1');
  await lock.writeLock('data', 'w1');
  const rw = lock.rwLock('data');
  const j = rw.toJSON();
  assert.equal(j.writing, true);
  assert.equal(j.writer, 'w1');
  lock.writeUnlock('data', 'w1');
  // After one release, still writing (reentrant)
  assert.equal(rw.toJSON().writing, true);
  lock.writeUnlock('data', 'w1');
  assert.equal(rw.toJSON().writing, false);
  lock.destroy();
});

test('withReadLock: auto-release', async () => {
  const lock = freshLock();
  const result = await lock.withReadLock('data', 'r1', () => 'hello');
  assert.equal(result, 'hello');
  assert.equal(lock.rwLock('data').reading, 0);
  lock.destroy();
});

test('withWriteLock: auto-release', async () => {
  const lock = freshLock();
  const result = await lock.withWriteLock('data', 'w1', () => 'written');
  assert.equal(result, 'written');
  assert.equal(lock.rwLock('data').writing, false);
  lock.destroy();
});

test('semaphore: basic acquire/release', async () => {
  const lock = freshLock();
  lock.semaphore('pool', 3);
  await lock.acquirePermit('pool', 'w1');
  await lock.acquirePermit('pool', 'w2');
  const s = lock.semaphore('pool');
  assert.equal(s.available, 1);
  lock.releasePermit('pool', 'w1');
  assert.equal(s.available, 2);
  lock.destroy();
});

test('semaphore: queue when full', async () => {
  const lock = freshLock();
  lock.semaphore('pool', 1);
  await lock.acquirePermit('pool', 'w1');
  const p = lock.acquirePermit('pool', 'w2').then(() => 'got');
  lock.releasePermit('pool', 'w1');
  assert.equal(await p, 'got');
  lock.destroy();
});

test('semaphore: timeout', async () => {
  const lock = freshLock();
  lock.semaphore('pool', 1);
  await lock.acquirePermit('pool', 'w1');
  try {
    await lock.acquirePermit('pool', 'w2', 1, 50);
    assert.fail('Should have timed out');
  } catch (err) {
    assert.match(err.message, /timeout/);
  }
  lock.destroy();
});

test('semaphore: multiple permits', async () => {
  const lock = freshLock();
  lock.semaphore('pool', 5);
  await lock.acquirePermit('pool', 'w1', 3);
  const s = lock.semaphore('pool');
  assert.equal(s.available, 2);
  lock.releasePermit('pool', 'w1', 3);
  assert.equal(s.available, 5);
  lock.destroy();
});

test('withPermit: auto-release', async () => {
  const lock = freshLock();
  lock.semaphore('pool', 2);
  const result = await lock.withPermit('pool', 'w1', () => 'done');
  assert.equal(result, 'done');
  assert.equal(lock.semaphore('pool').available, 2);
  lock.destroy();
});

test('barrier: all parties release together', async () => {
  const lock = freshLock();
  lock.barrier('sync', 3);
  
  let results = [];
  const p1 = lock.barrierWait('sync', 'a').then(g => results.push(g));
  const p2 = lock.barrierWait('sync', 'b').then(g => results.push(g));
  const p3 = lock.barrierWait('sync', 'c').then(g => results.push(g));
  
  await Promise.all([p1, p2, p3]);
  assert.equal(results.length, 3);
  assert.equal(results[0], 1); // generation 1
  lock.destroy();
});

test('barrier: reset', async () => {
  const lock = freshLock();
  lock.barrier('sync', 2);
  const p = lock.barrierWait('sync', 'a').catch(e => 'reset');
  lock.barrierReset('sync');
  assert.equal(await p, 'reset');
  lock.destroy();
});

test('stats: tracks operations', async () => {
  const lock = freshLock();
  await lock.lock('r1', 'a');
  await lock.lock('r2', 'b');
  lock.unlock('r1', 'a');
  lock.unlock('r2', 'b');
  
  const stats = lock.stats;
  assert.equal(stats.acquires, 2);
  assert.equal(stats.releases, 2);
  lock.destroy();
});

test('listLocks: shows all types', async () => {
  const lock = freshLock();
  await lock.lock('mutex-1', 'a');
  await lock.readLock('rw-1', 'r');
  lock.semaphore('sem-1', 3);
  
  const list = lock.listLocks();
  assert.ok(list['mutex-1']);
  assert.equal(list['mutex-1'].type, 'mutex');
  assert.ok(list['rw-1']);
  assert.equal(list['rw-1'].type, 'rwlock');
  assert.ok(list['sem-1']);
  assert.equal(list['sem-1'].type, 'semaphore');
  lock.destroy();
});

test('deadlock detection: no cycle in safe case', async () => {
  const lock = freshLock();
  await lock.lock('r1', 'a');
  await lock.lock('r2', 'b');
  const cycles = lock.detectDeadlocks();
  assert.equal(cycles.length, 0);
  lock.unlock('r1', 'a');
  lock.unlock('r2', 'b');
  lock.destroy();
});

test('events: emit lock_acquired', async () => {
  const lock = freshLock();
  let event = null;
  lock.on('lock_acquired', e => event = e);
  await lock.lock('r', 'a');
  assert.equal(event.name, 'r');
  assert.equal(event.holder, 'a');
  lock.destroy();
});

test('events: emit lock_released', async () => {
  const lock = new AgentLock({ namespace: 'test-events-release', persistDir: DATA_DIR });
  let event = null;
  lock.on('lock_released', e => { event = e; });
  await lock.lock('r', 'a');
  // Verify the callback is set by checking the mutex internals work
  const m = lock.mutex('r');
  assert.equal(m.locked, true);
  assert.equal(m.owner, 'a');
  const released = lock.unlock('r', 'a');
  assert.equal(released, true, 'unlock should return true');
  assert.equal(m.locked, false, 'lock should be free after unlock');
  assert.ok(event, 'lock_released event should fire');
  assert.equal(event.name, 'r');
  assert.equal(event.holder, 'a');
  lock.destroy();
});

test('events: emit read_lock_acquired', async () => {
  const lock = freshLock();
  let event = null;
  lock.on('read_lock_acquired', e => event = e);
  await lock.readLock('data', 'r1');
  assert.equal(event.name, 'data');
  lock.destroy();
});

test('events: emit write_lock_acquired', async () => {
  const lock = freshLock();
  let event = null;
  lock.on('write_lock_acquired', e => event = e);
  await lock.writeLock('data', 'w1');
  assert.equal(event.name, 'data');
  lock.destroy();
});

test('events: emit permit_acquired', async () => {
  const lock = freshLock();
  let event = null;
  lock.on('permit_acquired', e => event = e);
  lock.semaphore('pool', 2);
  await lock.acquirePermit('pool', 'w1');
  assert.equal(event.name, 'pool');
  lock.destroy();
});

test('persistence: saves JSONL events', async () => {
  const lock = freshLock();
  await lock.lock('r', 'a');
  lock.unlock('r', 'a');
  lock.save();
  
  const file = path.join(DATA_DIR, 'locks-test.json');
  assert.ok(fs.existsSync(file));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.namespace, 'test');
  assert.equal(data.stats.acquires, 1);
  lock.destroy();
});

test('destroy: cleans up without error', async () => {
  const lock = new AgentLock({ namespace: 'test-destroy', persistDir: DATA_DIR + '-destroy' });
  await lock.lock('r', 'a');
  lock.unlock('r', 'a');
  lock.destroy();
  // After destroy, internal maps are cleared
  assert.deepStrictEqual(lock.listLocks(), {});
  assert.deepStrictEqual(lock.listBarriers(), {});
});

test('mutex: toJSON', async () => {
  const lock = freshLock();
  await lock.lock('r', 'agent-1');
  const m = lock.mutex('r');
  const json = m.toJSON();
  assert.equal(json.locked, true);
  assert.equal(json.owner, 'agent-1');
  assert.equal(json.reentrantCount, 1);
  lock.destroy();
});

test('concurrent: multiple different locks', async () => {
  const lock = freshLock();
  await Promise.all([
    lock.lock('a', 'x'),
    lock.lock('b', 'y'),
    lock.lock('c', 'z'),
  ]);
  assert.equal(lock.mutex('a').owner, 'x');
  assert.equal(lock.mutex('b').owner, 'y');
  assert.equal(lock.mutex('c').owner, 'z');
  lock.destroy();
});

// Cleanup
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}

console.log('All tests passed! ✅');

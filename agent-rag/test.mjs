/**
 * agent-rag tests
 */

import { AgentRAG } from './index.mjs';

let passed = 0, failed = 0, errors = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; errors.push(msg); console.error(`  ✗ ${msg}`); }
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; errors.push(`${name}: ${e.message}`); console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('agent-rag tests\n');

// ─── Basic Document Management ───────────────────────────────────────────────

test('add document returns docId', () => {
  const rag = new AgentRAG();
  const id = rag.addDocument('Hello world test document.');
  assert(typeof id === 'string' && id.length > 0, 'docId should be a string');
  rag.destroy();
});

test('get document by ID', () => {
  const rag = new AgentRAG();
  const id = rag.addDocument('Test document', { source: 'test' });
  const doc = rag.getDocument(id);
  assert(doc !== null, 'document should exist');
  assert(doc.text === 'Test document', 'text should match');
  assert(doc.metadata.source === 'test', 'metadata should match');
  rag.destroy();
});

test('delete document', () => {
  const rag = new AgentRAG();
  const id = rag.addDocument('To be deleted');
  assert(rag.deleteDocument(id) === true, 'delete should return true');
  assert(rag.getDocument(id) === null, 'document should be gone');
  rag.destroy();
});

test('list documents', () => {
  const rag = new AgentRAG();
  rag.addDocument('Doc 1');
  rag.addDocument('Doc 2');
  rag.addDocument('Doc 3');
  const docs = rag.listDocuments();
  assert(docs.length === 3, 'should have 3 documents');
  rag.destroy();
});

test('add multiple documents', () => {
  const rag = new AgentRAG();
  const ids = rag.addDocuments(['Doc A', 'Doc B', { text: 'Doc C', metadata: { tag: 'c' } }]);
  assert(ids.length === 3, 'should return 3 IDs');
  assert(rag.listDocuments().length === 3, 'should have 3 docs');
  rag.destroy();
});

test('update document', () => {
  const rag = new AgentRAG();
  const id = rag.addDocument('Original text');
  const newId = rag.updateDocument(id, 'Updated text');
  const doc = rag.getDocument(newId);
  assert(doc.text === 'Updated text', 'text should be updated');
  rag.destroy();
});

// ─── Namespaces ──────────────────────────────────────────────────────────────

test('namespace isolation', () => {
  const rag = new AgentRAG();
  rag.addDocument('Doc in ns1', {}, 'ns1');
  rag.addDocument('Doc in ns2', {}, 'ns2');
  assert(rag.listDocuments('ns1').length === 1, 'ns1 should have 1 doc');
  assert(rag.listDocuments('ns2').length === 1, 'ns2 should have 1 doc');
  assert(rag.namespaces().length === 2, 'should have 2 namespaces');
  rag.destroy();
});

// ─── Chunking ────────────────────────────────────────────────────────────────

test('fixed-size chunking', () => {
  const rag = new AgentRAG({ chunkStrategy: 'fixed', chunkSize: 100, chunkOverlap: 20 });
  const id = rag.addDocument('A'.repeat(250));
  const doc = rag.getDocument(id);
  assert(doc.chunks.length > 1, 'should create multiple chunks');
  rag.destroy();
});

test('sentence chunking', () => {
  const rag = new AgentRAG({ chunkStrategy: 'sentence' });
  const id = rag.addDocument('First sentence. Second sentence. Third sentence.');
  const doc = rag.getDocument(id);
  assert(doc.chunks.length === 3, 'should create 3 chunks for 3 sentences');
  rag.destroy();
});

test('paragraph chunking', () => {
  const rag = new AgentRAG({ chunkStrategy: 'paragraph' });
  const id = rag.addDocument('Para 1\n\nPara 2\n\nPara 3');
  const doc = rag.getDocument(id);
  assert(doc.chunks.length === 3, 'should create 3 chunks for 3 paragraphs');
  rag.destroy();
});

test('recursive chunking', () => {
  const rag = new AgentRAG({ chunkStrategy: 'recursive', chunkSize: 200 });
  const longText = 'This is a long paragraph. '.repeat(20) + '\n\n' + 'Another paragraph here. '.repeat(10);
  const id = rag.addDocument(longText);
  const doc = rag.getDocument(id);
  assert(doc.chunks.length > 0, 'should create chunks');
  rag.destroy();
});

// ─── Search ──────────────────────────────────────────────────────────────────

test('basic search returns results', () => {
  const rag = new AgentRAG();
  rag.addDocument('JavaScript is a programming language used for web development');
  rag.addDocument('Python is great for data science and machine learning');
  rag.addDocument('Rust focuses on memory safety in systems programming');
  const results = rag.search('programming language', { topK: 3 });
  assert(results.length > 0, 'should return results');
  assert(results[0].score > 0, 'score should be positive');
  rag.destroy();
});

test('search respects topK', () => {
  const rag = new AgentRAG();
  for (let i = 0; i < 10; i++) rag.addDocument(`Document ${i} about programming`);
  const results = rag.search('programming', { topK: 3 });
  assert(results.length <= 3, 'should return at most 3 results');
  rag.destroy();
});

test('search respects namespace', () => {
  const rag = new AgentRAG();
  rag.addDocument('JavaScript programming', {}, 'ns1');
  rag.addDocument('Python programming', {}, 'ns2');
  const results = rag.search('programming', { namespace: 'ns1' });
  assert(results.length === 1, 'should find 1 result in ns1');
  rag.destroy();
});

test('search with metadata filters', () => {
  const rag = new AgentRAG();
  rag.addDocument('JS doc', { topic: 'javascript' });
  rag.addDocument('Python doc', { topic: 'python' });
  const results = rag.search('doc', { filters: { topic: 'python' } });
  assert(results.length === 1, 'should filter to python only');
  assert(results[0].metadata.topic === 'python', 'should be python doc');
  rag.destroy();
});

test('search minScore filter', () => {
  const rag = new AgentRAG();
  rag.addDocument('Completely unrelated content about cooking recipes');
  rag.addDocument('JavaScript programming language tutorial');
  const results = rag.search('JavaScript', { minScore: 0.5 });
  assert(results.every(r => r.score >= 0.5), 'all results should meet minScore');
  rag.destroy();
});

test('contextString returns formatted output', () => {
  const rag = new AgentRAG();
  rag.addDocument('Test content about AI agents');
  const ctx = rag.contextString('AI agents', 3);
  assert(ctx.includes('[1]'), 'should have numbered references');
  assert(ctx.includes('score:'), 'should include score');
  rag.destroy();
});

// ─── Re-ranking ──────────────────────────────────────────────────────────────

test('reranking boosts exact phrase matches', () => {
  const rag = new AgentRAG();
  rag.addDocument('This document mentions neural network training');
  rag.addDocument('Something about cooking and recipes');
  rag.addDocument('Deep learning uses neural network architectures for training');
  const withRerank = rag.search('neural network training', { topK: 3, rerank: true });
  const withoutRerank = rag.search('neural network training', { topK: 3, rerank: false });
  // With reranking, exact phrase match should score higher
  assert(withRerank[0].score >= withoutRerank[0].score, 'reranked should score >= non-reranked');
  rag.destroy();
});

// ─── Bigrams ─────────────────────────────────────────────────────────────────

test('bigram indexing enabled by default', () => {
  const rag = new AgentRAG({ enableBigrams: true });
  rag.addDocument('machine learning is a subset of artificial intelligence');
  const results = rag.search('machine learning', { topK: 1 });
  assert(results.length === 1, 'should find with bigram matching');
  rag.destroy();
});

test('bigram indexing can be disabled', () => {
  const rag = new AgentRAG({ enableBigrams: false });
  rag.addDocument('machine learning algorithms');
  const stats = rag.stats();
  assert(stats.totalChunks > 0, 'should still index');
  rag.destroy();
});

// ─── Stats ───────────────────────────────────────────────────────────────────

test('stats returns correct counts', () => {
  const rag = new AgentRAG();
  rag.addDocument('Doc 1 with several words here', {}, 'ns1');
  rag.addDocument('Doc 2 also has words', {}, 'ns1');
  rag.addDocument('Doc 3 in namespace two', {}, 'ns2');
  const s = rag.stats();
  assert(s.namespaces === 2, 'should have 2 namespaces');
  assert(s.totalDocuments === 3, 'should have 3 documents');
  assert(s.totalChunks === 3, 'should have 3 chunks');
  const s1 = rag.stats('ns1');
  assert(s1.documents === 2, 'ns1 should have 2 docs');
  rag.destroy();
});

// ─── Persistence ─────────────────────────────────────────────────────────────

test('save and load round-trips data', async () => {
  const path = '/tmp/agent-rag-test-' + Date.now() + '.json';
  const rag1 = new AgentRAG({ persistPath: path });
  rag1.addDocument('Persistent document', { source: 'test' });
  await rag1.save();
  rag1.destroy();

  const rag2 = new AgentRAG({ persistPath: path });
  await rag2.load();
  assert(rag2.listDocuments().length === 1, 'should have 1 doc after load');
  const results = rag2.search('persistent', { topK: 1 });
  assert(results.length === 1, 'should find loaded doc');
  rag2.destroy();
});

// ─── Export/Import ───────────────────────────────────────────────────────────

test('export and import round-trips', () => {
  const rag1 = new AgentRAG();
  rag1.addDocument('Export me', { tag: 'test' });
  const data = rag1.export();
  rag1.destroy();

  const rag2 = new AgentRAG();
  rag2.import(data);
  assert(rag2.listDocuments().length === 1, 'should have 1 doc after import');
  rag2.destroy();
});

// ─── Events ──────────────────────────────────────────────────────────────────

test('events fire on add/delete', () => {
  const rag = new AgentRAG();
  let added = false, deleted = false;
  rag.on('documentAdded', () => added = true);
  rag.on('documentDeleted', () => deleted = true);
  const id = rag.addDocument('Event test');
  rag.deleteDocument(id);
  assert(added, 'documentAdded should fire');
  assert(deleted, 'documentDeleted should fire');
  rag.destroy();
});

// ─── Clear ───────────────────────────────────────────────────────────────────

test('clear removes all data', () => {
  const rag = new AgentRAG();
  rag.addDocument('To be cleared', {}, 'ns1');
  rag.addDocument('Also cleared', {}, 'ns2');
  rag.clear();
  assert(rag.namespaces().length === 0, 'should have no namespaces');
  rag.destroy();
});

test('clear specific namespace', () => {
  const rag = new AgentRAG();
  rag.addDocument('In ns1', {}, 'ns1');
  rag.addDocument('In ns2', {}, 'ns2');
  rag.clear('ns1');
  assert(rag.listDocuments('ns1').length === 0, 'ns1 should be empty');
  assert(rag.listDocuments('ns2').length === 1, 'ns2 should be intact');
  rag.destroy();
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

test('empty query returns no results', () => {
  const rag = new AgentRAG();
  rag.addDocument('Some content');
  assert(rag.search('', { topK: 5 }).length === 0, 'empty query should return 0 results');
  assert(rag.search('   ', { topK: 5 }).length === 0, 'whitespace query should return 0 results');
  rag.destroy();
});

test('search on empty index returns no results', () => {
  const rag = new AgentRAG();
  assert(rag.search('anything').length === 0, 'empty index should return 0 results');
  rag.destroy();
});

test('nonexistent document get returns null', () => {
  const rag = new AgentRAG();
  assert(rag.getDocument('nonexistent') === null, 'should return null');
  rag.destroy();
});

test('delete nonexistent document returns false', () => {
  const rag = new AgentRAG();
  assert(rag.deleteDocument('nonexistent') === false, 'should return false');
  rag.destroy();
});

// ─── Print results ───────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}

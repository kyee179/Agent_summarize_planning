const { json, query, error } = require('./common.cjs');
function validateVectors(vectors, count) {
  if (!Array.isArray(vectors) || vectors.length !== count || !vectors.length || !Array.isArray(vectors[0]) || !vectors[0].length || vectors[0].length > 4096 ||
      vectors.some((v) => !Array.isArray(v) || v.length !== vectors[0].length || v.some((n) => typeof n !== 'number' || !Number.isFinite(n)) || v.every((n) => n === 0))) throw error('Invalid embedding vectors', 502);
  return vectors;
}
function cosine(a, b) {
  if (a.length !== b.length) return -1;
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return dot / (Math.sqrt(x) * Math.sqrt(y));
}
function fuse(lexical, semantic, limit) {
  const scores = new Map(), items = new Map();
  for (const list of [lexical, semantic]) list.forEach((item, i) => {
    scores.set(item.id, (scores.get(item.id) || 0) + 1 / (60 + i + 1)); items.set(item.id, item);
  });
  return [...items.values()].sort((a, b) => scores.get(b.id) - scores.get(a.id) || a.id.localeCompare(b.id)).slice(0, limit)
    .map(({ embedding: _embedding, model: _model, ...item }) => ({ ...item, relevance: Number(scores.get(item.id).toFixed(6)) }));
}
function createMemory(store, { fetchImpl, env = process.env, clock = () => new Date().toISOString() } = {}) {
  const model = env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  let indexing = false;
  async function identity(signal, timeout = 10000) {
    const tags = await json('http://127.0.0.1:11434/api/tags', {}, { fetchImpl, signal, timeout });
    const named = model.includes(':') ? model : `${model}:latest`;
    const tag = tags.models?.find((item) => (item.name || item.model) === named);
    if (!tag || typeof tag.digest !== 'string' || !/^(sha256:)?[a-f0-9]{64}$/.test(tag.digest)) throw error('Embedding model is not installed', 409);
    return `${named}@${tag.digest}`;
  }
  async function embed(input, signal, timeout = 10000, kind = 'document') {
    const texts = model.startsWith('nomic-embed-text') ? input.map((text) => `${kind === 'query' ? 'search_query' : 'search_document'}: ${text}`) : input;
    const result = await json('http://127.0.0.1:11434/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: texts, truncate: false }) }, { fetchImpl, signal, timeout, maxBytes: 4194304 });
    return validateVectors(result.embeddings, input.length);
  }
  return {
    model,
    async index(input) {
      if (input.consent !== true) throw error('Indexing journals requires explicit consent');
      if (input.semantic !== undefined && typeof input.semantic !== 'boolean') throw error('semantic must be a boolean');
      if (indexing) throw error('Memory indexing is already running', 409);
      const report = store.reindexMemory(store.listJournals());
      const chunks = store.memoryChunks();
      if (!input.semantic) return { ...report, mode: 'lexical', model, embedded: 0 };
      let embedded = 0, revision = null; const deadline = Date.now() + 50000; indexing = true;
      try {
        revision = await identity();
        const compatible=chunks.filter(item=>item.model===revision&&item.embeddingModel===model&&item.embedding);
        const pending=chunks.filter(item=>!compatible.some(current=>current.id===item.id));
        let dimension=compatible[0]?.embedding.length;
        embedded=compatible.length;
        let embeddedThisRun=0;
        // Bounded index job: at most 32 batches / 256 chunks and 50 seconds. Remaining chunks retain lexical search.
        for (let offset = 0; offset < Math.min(256, pending.length); offset += 8) {
          if (Date.now() >= deadline) throw error('Embedding job budget exhausted');
          const batch = pending.slice(offset, Math.min(offset + 8, 256));
          const vectors=await embed(batch.map(item=>item.content),undefined,Math.min(10000,deadline-Date.now()));
          if(dimension && vectors.some(vector=>vector.length!==dimension)) throw error('Embedding dimension changed');
          dimension ||= vectors[0].length;
          store.saveEmbeddings(batch,vectors,revision,model);
          embedded+=batch.length; embeddedThisRun+=batch.length;
        }
        return { ...report, mode: embedded ? 'hybrid' : 'lexical', model, embedded, embeddedThisRun, remaining: chunks.length-embedded, partial: embedded < chunks.length };
      } catch { return { ...report, mode: embedded ? 'hybrid' : 'lexical', model, embedded, remaining: chunks.length-embedded, partial: true, warning: 'Embedding job incomplete. Keyword search is ready; check Ollama/model and retry. Partial embeddings remain usable.' }; }
      finally { indexing = false; }
    },
    async search(input, signal) {
      const text = query(input.query), limit = input.limit ?? 5;
      if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw error('Memory result limit must be 1–8');
      const lexical = store.lexicalMemory(text);
      const candidates = store.memoryChunks().filter((item) => item.embeddingModel === model && item.embedding);
      let semantic = [], warning = null;
      if (candidates.length) {
        try {
          const deadline = Date.now() + 10000, revision = await identity(signal);
          const compatible = candidates.filter((item) => item.model === revision);
          if (!compatible.length) throw error('Embedding model changed; rebuild index');
          if (Date.now() >= deadline) throw error('Embedding search timed out');
          const [vector] = await embed([text], signal, deadline - Date.now(), 'query');
          semantic = compatible.filter((item) => item.embedding.length === vector.length).map((item) => ({ ...item, cosine: cosine(vector, item.embedding) }))
            .filter((item) => item.cosine > 0).sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id)).slice(0, 100);
        } catch { warning = 'Semantic search unavailable or model changed; showing keyword matches. Check Ollama and rebuild the index.'; }
      }
      if (/\p{Script=Han}/u.test(text) && candidates.length) warning = [warning, 'Chinese semantic retrieval quality has not been measured for the installed model; keyword matches remain available.'].filter(Boolean).join(' ');
      const items = fuse(lexical, semantic, limit);
      return { mode: semantic.length ? 'hybrid' : 'lexical', model, warning, items,
        evidence: items.map((item) => ({ id: item.id, sourceType: item.sourceType, sourceId: item.sourceId, sourceVersion: item.sourceVersion,
          locator: null, excerpt: item.content, observedAt: clock(), sourceTimestamp: item.updatedAt, verification: 'source_matched', facts: [] })) };
    }
  };
}
module.exports = { createMemory, validateVectors, cosine, fuse };

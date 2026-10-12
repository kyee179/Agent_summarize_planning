const { json, query, error, hash, publicUrl } = require('./common.cjs');
function plain(value, max) { return String(value || '').replace(/<[^>]*>/g, '').slice(0, max).trim(); }
function createResearch({ fetchImpl, env = process.env, clock = () => new Date().toISOString() } = {}) {
  let running = false, searches = [];
  return { configured: Boolean(env.BRAVE_SEARCH_API_KEY),
    async search(input, signal) {
      if (input.consent !== true) throw error('Sending a query to Brave Search requires consent');
      if (!env.BRAVE_SEARCH_API_KEY) throw error('Add BRAVE_SEARCH_API_KEY to the local .env and restart', 409);
      const text = query(input.query), observedAt = clock();
      searches = searches.filter((time) => Date.now() - time < 60000);
      if (running || searches.length >= 10) throw error('Search is busy or its local limit of 10 queries/minute is reached', 429);
      searches.push(Date.now()); running = true;
      const params = new URLSearchParams({ q: text, count: '3', safesearch: 'moderate', text_decorations: 'false' });
      let response;
      try { response = await json(`https://api.search.brave.com/res/v1/web/search?${params}`, { headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' } }, { fetchImpl, signal, maxBytes: 524288 }); }
      finally { running = false; }
      if (!response.web || !Array.isArray(response.web.results)) return { query: text, results: [], evidence: [] };
      const results = response.web.results.slice(0, 3).flatMap((result) => {
        const url = publicUrl(result.url), excerpt = plain(result.description, 2000), title = plain(result.title, 300);
        if (!url || !excerpt || !title) return [];
        const id = `web:${hash([url, excerpt]).slice(0, 40)}`;
        return [{ id, title, url, excerpt, retrievedAt: observedAt, confidence: 'low',
          confidenceReason: 'Search snippet only; the page and claim have not been verified.', claimStatus: 'snippet_only' }];
      });
      return { query: text, results, evidence: results.map((item) => ({ id: item.id, sourceType: 'web', sourceId: item.url.slice(0, 100) + ':' + hash(item.url).slice(0, 12), sourceVersion: hash([item.url, item.excerpt]),
        locator: item.url, excerpt: item.excerpt, observedAt, sourceTimestamp: null, verification: 'unverified', facts: [] })) };
    }
  };
}
module.exports = { createResearch };

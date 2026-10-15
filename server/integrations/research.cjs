const { json, query, error, hash, publicUrl } = require('./common.cjs');
function plain(value, max) { return String(value || '').replace(/<[^>]*>/g, '').slice(0, max).trim(); }

function createResearch({ fetchImpl, env = process.env, clock = () => new Date().toISOString() } = {}) {
  const provider = env.WEB_SEARCH_PROVIDER || (env.TAVILY_API_KEY || !env.BRAVE_SEARCH_API_KEY ? 'tavily' : 'brave');
  if (!['tavily', 'brave'].includes(provider)) throw error('WEB_SEARCH_PROVIDER must be tavily or brave', 409);
  const apiKey = provider === 'tavily' ? env.TAVILY_API_KEY : env.BRAVE_SEARCH_API_KEY;
  const providerName = provider === 'tavily' ? 'Tavily' : 'Brave Search';
  let running = false, searches = [];
  return { configured: Boolean(apiKey), provider, providerName,

    async search(input, signal) {
      if (input.consent !== true) throw error(`Sending a query to ${providerName} requires consent`);
      if (!apiKey) throw error(`Add ${provider === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_SEARCH_API_KEY'} to the local .env and restart`, 409);
      const text = query(input.query), observedAt = clock();
      searches = searches.filter((time) => Date.now() - time < 60000);
      if (running || searches.length >= 10) throw error('Search is busy or its local limit of 10 queries/minute is reached', 429);
      searches.push(Date.now()); running = true;
      const params = new URLSearchParams({ q: text, count: '3', safesearch: 'moderate', text_decorations: 'false' });
      let response;
      try { response = provider === 'tavily' ? await json('https://api.tavily.com/search', { method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, search_depth: 'basic', auto_parameters: false, topic: 'general', max_results: 3,
          include_answer: false, include_raw_content: false, include_images: false, include_usage: true })
      }, { fetchImpl, signal, maxBytes: 524288 }) : await json(`https://api.search.brave.com/res/v1/web/search?${params}`,  { headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' } }, { fetchImpl, signal, maxBytes: 524288 }); }
      finally { running = false; }
      const sources = provider === 'tavily' ? response.results : response.web?.results;
      if (!Array.isArray(sources)) throw error('Invalid web search response', 502);
      const results = sources.slice(0, 3).flatMap(

      (result) => {
        const url = publicUrl(result.url), excerpt = plain(provider === 'tavily' ? result.content : result.description, 2000), title = plain(result.title, 300);
        if (!url || !excerpt || !title) return [];
        const id = `web:${hash([url, excerpt]).slice(0, 40)}`;
        return [{ id, title, url, excerpt, retrievedAt: observedAt, confidence: 'low',
          confidenceReason: 'Search snippet only; the page and claim have not been verified.', claimStatus: 'snippet_only' }];
      });
      return { query: text, provider, usage: { credits: provider === 'tavily' && Number.isFinite(response.usage?.credits) && response.usage.credits >= 0 ? response.usage.credits : null }, results, evidence: results.map((item) => ({ id: item.id, sourceType: 'web', sourceId: item.url.slice(0, 100) + ':' + hash(item.url).slice(0, 12), sourceVersion: hash([item.url, item.excerpt]),
        locator: item.url, excerpt: item.excerpt, observedAt, sourceTimestamp: null, verification: 'unverified', facts: [] })) };
    }
  };
}
module.exports = { createResearch };

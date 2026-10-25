// Page scripts inside jsdom run in another realm: their AbortSignal is not a Node AbortSignal, and Node's fetch rejects it with
// "Expected signal to be an instance of AbortSignal". Every page fetch then failed silently (the dashboard showed "Reconnecting…"
// and the tests were asserting on empty charts). This wrapper forwards the request to Node's fetch and bridges the abort signal.
function pageFetch(base, cookie, extraHeaders) {
  return async (url, opts = {}) => {
    const init = { ...opts, headers: { ...(opts.headers || {}), ...(extraHeaders || {}), ...(cookie ? { Cookie: cookie } : {}) } };
    if (opts.signal) {
      const ac = new AbortController();
      if (opts.signal.aborted) ac.abort();
      else if (opts.signal.addEventListener) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
      init.signal = ac.signal;
    } else delete init.signal;
    return fetch(new URL(url, base), init);
  };
}

module.exports = { pageFetch };

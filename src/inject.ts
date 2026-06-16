// Runs in MAIN world — has direct access to the page's window.fetch.
// Cannot use chrome.* APIs here; bridges data to content.ts via postMessage.

const origFetch = window.fetch.bind(window);

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const response = await origFetch(input, init);

  const url =
    typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request).url;

  if (url.includes('hailuoai')) {
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    try {
      const data = await response.clone().json();
      window.postMessage({ __hailuo: true, url, method, data }, '*');
    } catch { /* not JSON */ }
  }

  return response;
};

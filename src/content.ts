// Runs in ISOLATED world — bridges postMessage from inject.ts (MAIN world) to background.

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data?.__hailuo) return;
  chrome.runtime.sendMessage({
    type: 'API_RESPONSE',
    url: event.data.url,
    method: event.data.method,
    data: event.data.data,
  });
});

import type { PopupMsg, BackgroundMsg } from './types';

// ── Generation state ──────────────────────────────────────────────────────────

interface GenState {
  shotId: string;
  port: chrome.runtime.Port;
  batchId: string | null;
  submitTimeSec: number;
  feedUrl: string | null;
  done: boolean;
}

const gens = new Map<number, GenState>();

// ── Keep-alive alarm ──────────────────────────────────────────────────────────

let keepAliveActive = false;

function startKeepAlive() {
  if (keepAliveActive) return;
  keepAliveActive = true;
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
}

function stopKeepAlive() {
  keepAliveActive = false;
  chrome.alarms.clear('keepAlive');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && gens.size === 0) {
    stopKeepAlive();
  }
});

// ── Helper utilities ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Navigate a tab and wait for it to finish loading.
 *  Registers the listener BEFORE calling update to avoid the race condition
 *  where the tab loads before the listener is attached. */
async function navigateAndWait(tabId: number, url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        finish();
      }
    };

    // Register FIRST, then navigate
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: true }).then(() => {
      // Fallback: if the tab is already 'complete' right after update returns,
      // the listener may have already fired — check and resolve if so.
      chrome.tabs.get(tabId, (tab) => {
        if (tab?.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          finish();
        }
      });
    });
  });
}

async function exec<T extends unknown[]>(
  tabId: number,
  fn: (...args: T) => unknown,
  args: T
) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: fn as (...args: unknown[]) => unknown,
    args,
  });
}

// Runs in the MAIN world — required for Slate/React DOM manipulation
// (isolated world has a separate JS context; Slate's editor.selection lives in MAIN)
async function execMain<T extends unknown[]>(
  tabId: number,
  fn: (...args: T) => unknown,
  args: T
) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: fn as (...args: unknown[]) => unknown,
    args,
    world: 'MAIN' as chrome.scripting.ExecutionWorld,
  });
}

function notify(port: chrome.runtime.Port, shotId: string, step: string) {
  try {
    port.postMessage({ type: 'SHOT_PROGRESS', shotId, step } as BackgroundMsg);
  } catch {
    // Port may be closed
  }
}

// ── Self-contained injected functions ─────────────────────────────────────────
// These run inside the page context — no closures over module variables allowed.

function clearInputs() {
  // The remove button is opacity-0 by default (only shown on hover).
  // Simulate mouseenter on the container so React tracks hover state,
  // then click the remove button directly.
  document.querySelectorAll<HTMLElement>('.upload-image-container').forEach(container => {
    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const removeBtn = container.querySelector<HTMLElement>('button[aria-label="Remove image"]');
    if (removeBtn) removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

}

function dismissModal() {
  const btn = document.querySelector<HTMLElement>(
    'section.fixed button, [aria-label="Close"], .close-btn'
  );
  btn?.click();
}

function selectModel(model: string) {
  const btn = document.querySelector<HTMLElement>(
    "[data-tour='model-selection-guide']"
  );
  if (!btn) return;
  btn.click();
  setTimeout(() => {
    const divs = Array.from(document.querySelectorAll('div.font-500'));
    const target = divs.find(
      (d) => d.textContent?.trim() === model
    ) as HTMLElement | undefined;
    if (target) {
      const row = target.closest(
        '[class*="flex"][class*="items-center"]'
      ) as HTMLElement | null;
      (row ?? target).click();
    }
  }, 1200);
}

function uploadImage(base64: string) {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    "input[type='file'][accept='.jpg,.jpeg,.png,.webp']"
  );
  if (!inputs.length) throw new Error('No file input found');
  const input = inputs[0];

  // Hailuo hides the file input — make it interactable first (mirrors Python Playwright step)
  input.style.display = 'block';
  input.style.opacity = '1';
  input.style.position = 'fixed';
  input.style.width = '1px';
  input.style.height = '1px';

  const raw = atob(base64.includes(',') ? base64.split(',')[1] : base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const file = new File([bytes], 'image.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function fillPrompt(prompt: string) {
  const el = document.querySelector<HTMLElement>('#video-create-textarea');
  if (!el) throw new Error('Prompt editor not found');

  el.click();
  el.focus();

  setTimeout(() => {
    // selectAll fires selectionchange → Slate's listener (in MAIN world) syncs
    // its internal editor.selection to "all selected"
    document.execCommand('selectAll');

    // Wait one tick for Slate to process the selectionchange state update
    setTimeout(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', prompt);
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
    }, 100);
  }, 500);
}

function clickGenerate() {
  const btn = document.querySelector<HTMLButtonElement>('button.new-color-btn-bg');
  if (!btn) throw new Error('Generate button not found');
  btn.click();
}

// ── API response parsing (ported from Python main.py) ────────────────────────

function deepFind(obj: unknown, key: string, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof obj !== 'object' || obj === null) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFind(item, key, depth + 1);
      if (r) return r;
    }
  } else {
    const o = obj as Record<string, unknown>;
    if (key in o && o[key]) return String(o[key]);
    for (const v of Object.values(o)) {
      const r = deepFind(v, key, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function extractVideoUrl(
  data: unknown,
  batchId: string | null,
  submitTimeSec: number
): string | null {
  try {
    const d = (
      (data as Record<string, unknown>)?.data ?? data
    ) as Record<string, unknown>;
    const batchFeeds = d?.batchFeeds as unknown[];
    if (!Array.isArray(batchFeeds)) return null;

    for (const batch of batchFeeds) {
      const b = batch as Record<string, unknown>;
      const bid = String(b.batchID ?? '');
      const feeds = (b.feeds as unknown[]) ?? [];

      for (const feed of feeds) {
        const f = feed as Record<string, unknown>;
        const info = (f.commonInfo ?? {}) as Record<string, unknown>;
        const status = Number(info.status ?? 0);
        const createTime = Number(info.createTime ?? 0);

        if (status !== 2) continue;
        if (batchId && bid !== batchId) continue;
        if (!batchId && createTime <= submitTimeSec) continue;

        const meta = f.metaInfo as Record<string, unknown>;
        const videoMetaInfo = (meta?.videoMetaInfo ?? {}) as Record<string, unknown>;
        const mediaInfo = (videoMetaInfo?.mediaInfo ?? {}) as Record<string, unknown>;
        const videoUrl = mediaInfo?.url as string | undefined;
        if (videoUrl) return videoUrl;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

// ── Main generation orchestrator ──────────────────────────────────────────────

async function runGeneration(
  shot: { id: string; prompt: string; imageBase64: string | null; model: string },
  port: chrome.runtime.Port
) {
  const HAILUO_URL = 'https://hailuoai.video/create/image-to-video';

  notify(port, shot.id, 'Opening Hailuo tab...');

  // Find existing Hailuo tab or create one
  const tabs = await chrome.tabs.query({ url: 'https://hailuoai.video/*' });
  let tabId: number;

  if (tabs.length > 0 && tabs[0].id != null) {
    tabId = tabs[0].id;
    // Only navigate if not already on the create page — avoids unnecessary refresh
    if (!tabs[0].url?.startsWith(HAILUO_URL)) {
      notify(port, shot.id, 'Waiting for page to load...');
      await navigateAndWait(tabId, HAILUO_URL);
      await sleep(4000);
    } else {
      await chrome.tabs.update(tabId, { active: true });
      // Clear previous image and prompt before starting the next shot
      notify(port, shot.id, 'Clearing previous inputs...');
      await exec(tabId, clearInputs, []);
      await sleep(1000);
    }
  } else {
    const tab = await chrome.tabs.create({ url: HAILUO_URL });
    if (!tab.id) throw new Error('Failed to create tab');
    tabId = tab.id;
    notify(port, shot.id, 'Waiting for page to load...');
    await navigateAndWait(tabId, HAILUO_URL);
    await sleep(4000);
  }

  // Register gen state before any scripting so content script messages land
  const genState: GenState = {
    shotId: shot.id,
    port,
    batchId: null,
    submitTimeSec: 0,
    feedUrl: null,
    done: false,
  };
  gens.set(tabId, genState);

  // Dismiss any modal
  try {
    await exec(tabId, dismissModal, []);
    await sleep(500);
  } catch {
    // No modal — continue
  }

  // Select model
  notify(port, shot.id, `Selecting model: ${shot.model}...`);
  await exec(tabId, selectModel, [shot.model]);
  await sleep(3000); // wait for dropdown close animation

  // Start image upload in background (don't await yet)
  const uploadPromise: Promise<void> = shot.imageBase64
    ? (async () => {
      notify(port, shot.id, 'Uploading reference image...');
      await exec(tabId, uploadImage, [shot.imageBase64!]);
      await sleep(15000); // wait for Hailuo server-side upload to confirm
    })()
    : Promise.resolve();

  // Fill prompt in parallel — ClipboardEvent doesn't need window focus
  notify(port, shot.id, 'Filling prompt...');
  await execMain(tabId, fillPrompt, [shot.prompt]);
  await sleep(2000);

  // Now wait for image upload to finish before clicking generate
  await uploadPromise;

  // Record submission time
  genState.submitTimeSec = Math.floor(Date.now() / 1000);

  // Click generate
  notify(port, shot.id, 'Clicking Generate...');
  await exec(tabId, clickGenerate, []);

  notify(port, shot.id, 'Waiting for video generation...');

  // Wait for content script to deliver result via API_RESPONSE messages
  // The gen state is already registered — handleApiResponse below will resolve
  await waitForGenCompletion(tabId, shot.id);
}

function waitForGenCompletion(tabId: number, shotId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();

    const interval = setInterval(() => {
      const gen = gens.get(tabId);

      // Tab was removed from map — generation finished (done or error handled elsewhere)
      if (!gen || gen.done) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (gen.shotId !== shotId) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(interval);
        gens.delete(tabId);
        reject(new Error('Generation timed out after 10 minutes'));
      }
    }, 3000);
  });
}

// ── Content script message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'API_RESPONSE') return;
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  const gen = gens.get(tabId);
  if (!gen || gen.done) return;

  // Capture batch ID from POST responses
  if (msg.method === 'POST' && !gen.batchId) {
    const bid = deepFind(msg.data, 'batchID');
    if (bid) {
      gen.batchId = bid;
      notify(gen.port, gen.shotId, `Processing... (batch ${bid})`);
    }
  }

  // Capture feed URL from GET responses that contain batchFeeds
  if (msg.method === 'GET' && !gen.feedUrl) {
    const d = (
      (msg.data as Record<string, unknown>)?.data ?? msg.data
    ) as Record<string, unknown>;
    if (Array.isArray(d?.batchFeeds)) {
      gen.feedUrl = msg.url;
    }
  }

  // Check if any feed contains a completed video
  const videoUrl = extractVideoUrl(msg.data, gen.batchId, gen.submitTimeSec);
  if (videoUrl) {
    gen.done = true;
    gens.delete(tabId);
    try {
      gen.port.postMessage({
        type: 'SHOT_DONE',
        shotId: gen.shotId,
        videoUrl,
      } as BackgroundMsg);
    } catch {
      // Port closed
    }
    stopKeepAlive();
  }
});

// ── Port connection from popup tab ───────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'generation') return;

  port.onMessage.addListener(async (msg: PopupMsg) => {
    if (msg.type === 'GENERATE') {
      startKeepAlive();
      try {
        await runGeneration(msg.shot, port);
      } catch (e) {
        try {
          port.postMessage({
            type: 'SHOT_ERROR',
            shotId: msg.shot.id,
            error: (e as Error).message,
          } as BackgroundMsg);
        } catch {
          // Port closed
        }
        stopKeepAlive();
      }
    }
  });

  port.onDisconnect.addListener(() => {
    // Clean up any pending generations on port disconnect
    for (const [tabId, gen] of gens.entries()) {
      if (gen.port === port) {
        gens.delete(tabId);
      }
    }
    if (gens.size === 0) {
      stopKeepAlive();
    }
  });
});

// ── Extension icon click → open full tab ────────────────────────────────────

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/index.html') });
});

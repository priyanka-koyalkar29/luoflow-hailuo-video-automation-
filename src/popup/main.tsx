import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';
import App from './App';

// If loaded as a popup (no ?tab param), open as a full tab and close the popup
if (!window.location.search.includes('tab=1')) {
  chrome.tabs.create({
    url: chrome.runtime.getURL('popup/index.html') + '?tab=1',
  });
  window.close();
} else {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element not found');

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

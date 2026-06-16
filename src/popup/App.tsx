import { useState, useRef, useEffect, useCallback } from 'react';
import type { Shot, Screen, BackgroundMsg, PopupMsg, LogEntry } from '../types';
import UploadScreen from './components/UploadScreen';
import ReviewScreen from './components/ReviewScreen';

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  }, []);

  // Connect to background service worker
  useEffect(() => {
    addLog('LuoFlow console initialized.', 'info');
    
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'generation' });
      portRef.current = port;
      addLog('Connection to background automation worker established.', 'success');
    } catch (e) {
      addLog('Failed to connect to background worker. Ensure extension is loaded.', 'error');
      return;
    }

    port.onMessage.addListener((msg: BackgroundMsg) => {
      if (msg.type === 'SHOT_PROGRESS') {
        setShots((prev) => {
          const shot = prev.find((s) => s.id === msg.shotId);
          if (shot) {
            addLog(`[Shot ${shot.shotNumber}] ${msg.step}`, 'info');
          }
          return prev.map((s) =>
            s.id === msg.shotId ? { ...s, progress: msg.step } : s
          );
        });
      } else if (msg.type === 'SHOT_DONE') {
        setShots((prev) => {
          const shot = prev.find((s) => s.id === msg.shotId);
          if (shot) {
            addLog(`[Shot ${shot.shotNumber}] Video completed successfully! URL collected.`, 'success');
          }
          return prev.map((s) =>
            s.id === msg.shotId
              ? { ...s, status: 'done', videoUrl: msg.videoUrl, progress: undefined }
              : s
          );
        });
      } else if (msg.type === 'SHOT_ERROR') {
        setShots((prev) => {
          const shot = prev.find((s) => s.id === msg.shotId);
          if (shot) {
            addLog(`[Shot ${shot.shotNumber}] Failed: ${msg.error}`, 'error');
          }
          return prev.map((s) =>
            s.id === msg.shotId
              ? { ...s, status: 'error', errorMsg: msg.error, progress: undefined }
              : s
          );
        });
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
      addLog('Automation connection disconnected.', 'warning');
    });

    return () => {
      try {
        port.disconnect();
      } catch {
        // Already disconnected
      }
    };
  }, [addLog]);

  // Persist shots to chrome.storage.local for resilience
  useEffect(() => {
    if (shots.length > 0) {
      chrome.storage.local.set({ shots });
    }
  }, [shots]);

  // Restore shots from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['shots'], (result) => {
      if (result.shots && result.shots.length > 0) {
        setShots(result.shots);
        setScreen('review');
        addLog(`Restored ${result.shots.length} shots from local session.`, 'info');
      }
    });
  }, []);

  const generateShot = useCallback((shot: Shot, model: string) => {
    if (!portRef.current) {
      addLog('No automation port connection active. Cannot generate.', 'error');
      return;
    }

    setShots((prev) =>
      prev.map((s) =>
        s.id === shot.id ? { ...s, status: 'generating', progress: 'Starting...' } : s
      )
    );

    const msg: PopupMsg = {
      type: 'GENERATE',
      shot: {
        id: shot.id,
        prompt: shot.prompt,
        imageBase64: shot.imageBase64,
        model,
      },
    };

    addLog(`[Shot ${shot.shotNumber}] Enqueued to background automation.`, 'info');
    portRef.current.postMessage(msg);
  }, [addLog]);

  // Manual retry handler
  const retryShot = useCallback((shot: Shot, model: string) => {
    if (!portRef.current) {
      addLog('No connection active. Cannot retry.', 'error');
      return;
    }

    setShots((prev) =>
      prev.map((s) =>
        s.id === shot.id ? { ...s, status: 'generating', progress: 'Retrying...', errorMsg: undefined } : s
      )
    );

    addLog(`[Shot ${shot.shotNumber}] Retrying generation...`, 'warning');

    const msg: PopupMsg = {
      type: 'GENERATE',
      shot: {
        id: shot.id,
        prompt: shot.prompt,
        imageBase64: shot.imageBase64,
        model,
      },
    };

    portRef.current.postMessage(msg);
  }, [addLog]);

  const handleShotsLoaded = (newShots: Shot[]) => {
    setShots(newShots);
    setScreen('review');
    addLog(`Loaded ${newShots.length} shots from storyboard file.`, 'success');
  };

  const handleOpenHailuo = () => {
    chrome.tabs.create({ url: 'https://hailuoai.video/create/image-to-video' });
    addLog('Opened Hailuo AI Create page in a new tab.', 'info');
  };

  const handleClearData = () => {
    chrome.storage.local.remove(['shots']);
    setShots([]);
    setScreen('upload');
    setLogs([]);
    addLog('Cleared session and reset storyboard.', 'warning');
  };

  return (
    <div className="min-h-screen bg-[#0b0a0f] text-gray-200 relative">
      {screen === 'upload' && (
        <UploadScreen onShotsLoaded={handleShotsLoaded} />
      )}
      {screen === 'review' && (
        <ReviewScreen
          shots={shots}
          setShots={setShots}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          logs={logs}
          clearLogs={() => setLogs([])}
          addLog={addLog}
          onBack={() => setScreen('upload')}
          onOpenHailuo={handleOpenHailuo}
          onClear={handleClearData}
          generateShot={generateShot}
          retryShot={retryShot}
        />
      )}
    </div>
  );
}

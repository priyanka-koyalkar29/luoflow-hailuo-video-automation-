import { useState, useRef, useCallback, useEffect } from 'react';
import type { Shot, LogEntry } from '../../types';
import StatsBar from './StatsBar';
import TerminalLog from './TerminalLog';

interface Props {
  shots: Shot[];
  setShots: React.Dispatch<React.SetStateAction<Shot[]>>;
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;
  logs: LogEntry[];
  clearLogs: () => void;
  addLog: (message: string, type?: LogEntry['type']) => void;
  onBack: () => void;
  onOpenHailuo: () => void;
  onClear: () => void;
  generateShot: (shot: Shot, model: string) => void;
  retryShot: (shot: Shot, model: string) => void;
}

const MODELS = [
  {
    id: 'Hailuo 2.3-Fast',
    label: 'Hailuo 2.3-Fast',
    badge: 'New',
    desc: 'Faster speed, higher efficiency',
    specs: '768P-1080P · 6s-10s',
  },
  {
    id: 'Hailuo 2.0',
    label: 'Hailuo 2.0',
    badge: null,
    desc: 'Best effect, ultra-clear quality',
    specs: '512P-1080P · 6s-10s',
  },
  {
    id: 'Hailuo 1.0-Director',
    label: 'Hailuo 1.0-Director',
    badge: null,
    desc: 'Control camera like a director',
    specs: '720P · 6s',
  },
];

export default function ReviewScreen({
  shots,
  setShots,
  selectedModel,
  setSelectedModel,
  logs,
  clearLogs,
  addLog,
  onBack,
  onOpenHailuo,
  onClear,
  generateShot,
  retryShot,
}: Props) {
  const [selectedId, setSelectedId] = useState(shots[0]?.id || '');
  const [imageDragging, setImageDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'grid'>('timeline');

  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);

  const selected = shots.find((s) => s.id === selectedId) || shots[0];
  const readyShots = shots.filter((s) => s.imagePreview && s.prompt);
  const readyCount = readyShots.length;
  const doneCount = shots.filter((s) => s.status === 'done').length;
  const errorCount = shots.filter((s) => s.status === 'error').length;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const updateShot = (id: string, updates: Partial<Shot>) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const deleteShot = (id: string) => {
    setShots((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        onBack();
      } else if (id === selectedId) {
        const idx = prev.findIndex((s) => s.id === id);
        setSelectedId(next[Math.min(idx, next.length - 1)].id);
      }
      return next;
    });
    addLog(`Deleted Shot ID ${id}`, 'warning');
  };

  // Crop image to 16:9 using canvas, returns base64 data URL
  const cropTo16x9 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const targetRatio = 16 / 9;
        let srcX = 0,
          srcY = 0,
          srcW = img.width,
          srcH = img.height;

        if (img.width / img.height > targetRatio) {
          srcW = Math.round(img.height * targetRatio);
          srcX = Math.round((img.width - srcW) / 2);
        } else {
          srcH = Math.round(img.width / targetRatio);
          srcY = Math.round((img.height - srcH) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 1280, 720);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = url;
    });
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const base64 = await cropTo16x9(file);
    updateShot(selected.id, {
      imageBase64: base64,
      imagePreview: base64,
      status: 'ready',
    });
    addLog(`Attached and cropped image for Shot ${selected.shotNumber}.`, 'success');
  };

  // Global Ctrl+V paste listener
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const blob = imageItem.getAsFile();
        if (blob) await handleImageFile(blob);
        return;
      }
      const files = Array.from(e.clipboardData?.files || []);
      const imageFile = files.find((f) => f.type.startsWith('image/'));
      if (imageFile) await handleImageFile(imageFile);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selected?.id, shots]);

  const handleImageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setImageDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    },
    [selected?.id, shots]
  );

  // ── Generation loops & automations ────────────────────────────────────────

  const waitForShotSubmitted = (shotId: string): Promise<void> => {
    return new Promise((resolve) => {
      const TIMEOUT_MS = 3 * 60 * 1000;
      const startTime = Date.now();

      const interval = setInterval(() => {
        if (!isRunningRef.current) { clearInterval(interval); resolve(); return; }
        if (Date.now() - startTime > TIMEOUT_MS) { clearInterval(interval); resolve(); return; }
        setShots((prev) => {
          const current = prev.find((s) => s.id === shotId);
          if (
            current &&
            (current.status === 'done' ||
              current.status === 'error' ||
              current.progress === 'Waiting for video generation...')
          ) {
            clearInterval(interval);
            resolve();
          }
          return prev;
        });
      }, 500);
    });
  };

  const waitForShotCompletion = (shotId: string): Promise<void> => {
    return new Promise((resolve) => {
      const TIMEOUT_MS = 12 * 60 * 1000;
      const startTime = Date.now();

      const interval = setInterval(() => {
        if (!isRunningRef.current) { clearInterval(interval); resolve(); return; }
        if (Date.now() - startTime > TIMEOUT_MS) {
          clearInterval(interval);
          setShots((prev) =>
            prev.map((s) =>
              s.id === shotId && s.status === 'generating'
                ? { ...s, status: 'error', errorMsg: 'Timed out waiting for result' }
                : s
            )
          );
          resolve();
          return;
        }
        setShots((prev) => {
          const current = prev.find((s) => s.id === shotId);
          if (current && (current.status === 'done' || current.status === 'error')) {
            clearInterval(interval);
            resolve();
          }
          return prev;
        });
      }, 2000);
    });
  };

  const runGeneration = async (model: string) => {
    setShowModelPicker(false);
    setSelectedModel(model);
    setIsRunning(true);
    isRunningRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;

    addLog(`Initializing queue generation run. Target: ${readyCount} shots.`, 'info');

    // Run shots that have images and prompts, and are not yet 'done'
    const shotsSnapshot = shots.filter((s) => s.imagePreview && s.prompt);

    for (let i = 0; i < shotsSnapshot.length; i++) {
      if (!isRunningRef.current) break;

      // Simple Pause/Resume Handler
      if (isPausedRef.current) {
        addLog('Automation queue is paused. Awaiting resume command...', 'warning');
        while (isPausedRef.current && isRunningRef.current) {
          await sleep(1000);
        }
        if (!isRunningRef.current) break;
      }

      const shot = shotsSnapshot[i];

      // Skip completed ones
      const currentStatus = shots.find((s) => s.id === shot.id)?.status;
      if (currentStatus === 'done') {
        addLog(`[Shot ${shot.shotNumber}] Already completed. Skipping.`, 'info');
        continue;
      }

      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, status: 'generating' } : s))
      );

      generateShot(shot, model);
      await waitForShotSubmitted(shot.id);
    }

    // Await completions
    const activeGenerations = shotsSnapshot.filter((s) => {
      const live = shots.find((l) => l.id === s.id);
      return live?.status === 'generating';
    });

    if (activeGenerations.length > 0) {
      addLog(`Waiting for ${activeGenerations.length} active render pipelines to complete...`, 'info');
      await Promise.all(activeGenerations.map((shot) => waitForShotCompletion(shot.id)));
    }

    setIsRunning(false);
    isRunningRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    addLog('Automation run cycle finished.', 'success');
  };

  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    isPausedRef.current = next;
    addLog(next ? 'Queue execution paused. Current shot will finish submission.' : 'Queue execution resumed.', 'warning');
  };

  const stopGeneration = () => {
    isRunningRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
    isPausedRef.current = false;
    addLog('Generation stopped by user request.', 'error');
  };

  // Export URLs to a CSV file
  const handleExportUrls = () => {
    const completedShots = shots.filter((s) => s.status === 'done' && s.videoUrl);
    if (completedShots.length === 0) {
      addLog('No completed video links to export.', 'warning');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Shot Number,Prompt,Video URL\n';
    
    completedShots.forEach((s) => {
      const escapedPrompt = (s.prompt || '').replace(/"/g, '""');
      csvContent += `${s.shotNumber},"${escapedPrompt}",${s.videoUrl}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'luoflow_generated_videos.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog(`Exported ${completedShots.length} video URLs to CSV.`, 'success');
  };

  // ── Status styling helpers ────────────────────────────────────────────────

  const getStatusText = (shot: Shot) => {
    if (shot.status === 'done') return 'Completed';
    if (shot.status === 'generating') return shot.progress || 'Generating';
    if (shot.status === 'error') return 'Failed';
    if (shot.imagePreview && shot.prompt) return 'Ready';
    if (shot.imagePreview || shot.prompt) return 'Partial';
    return 'Draft';
  };

  const getStatusBadgeColor = (shot: Shot) => {
    if (shot.status === 'done') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    if (shot.status === 'generating') return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    if (shot.status === 'error') return 'bg-red-500/10 text-red-400 border border-red-500/20';
    if (shot.imagePreview && shot.prompt) return 'bg-violet-500/10 text-violet-400 border border-violet-500/20';
    return 'bg-gray-500/10 text-gray-400 border border-white/5';
  };

  const statusDot = (shot: Shot) => {
    if (shot.status === 'done') return 'bg-emerald-500 glow-green';
    if (shot.status === 'generating') return 'bg-blue-500 animate-pulse glow-blue';
    if (shot.status === 'error') return 'bg-red-500';
    if (shot.imagePreview && shot.prompt) return 'bg-violet-400 glow-purple';
    if (shot.imagePreview || shot.prompt) return 'bg-yellow-500';
    return 'bg-gray-600';
  };

  return (
    <div className="h-screen flex flex-col bg-[#0b0a0f] relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[350px] h-[350px] bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Navigation / Header */}
      <div className="bg-black/35 backdrop-blur-md border-b border-white/5 px-6 py-3 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            disabled={isRunning}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-violet-500/50 px-3 py-1.5 rounded-xl bg-white/[0.01] hover:bg-white/[0.03] transition-all disabled:opacity-40"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white tracking-tight">LuoFlow</span>
            <span className="text-gray-600 text-xs">|</span>
            <span className="text-xs text-gray-400 font-medium">Storyboard Studio</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-black/40 border border-white/5 rounded-xl p-0.5">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'timeline'
                ? 'bg-violet-600 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setActiveTab('grid')}
            className={`text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'grid'
                ? 'bg-violet-600 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Storyboard Grid
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <button
                onClick={togglePause}
                className="text-xs text-yellow-400 hover:text-yellow-300 border border-yellow-500/20 px-3 py-1.5 rounded-xl hover:bg-yellow-950/20 transition-all font-semibold"
              >
                {isPaused ? 'Continue' : 'Pause'}
              </button>
              <button
                onClick={stopGeneration}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 px-3 py-1.5 rounded-xl hover:bg-red-950/20 transition-all font-semibold"
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleExportUrls}
                disabled={doneCount === 0}
                className="text-xs text-violet-300 hover:text-white border border-violet-500/20 hover:border-violet-500/50 px-3 py-1.5 rounded-xl hover:bg-violet-950/10 transition-all disabled:opacity-40 disabled:pointer-events-none"
                title="Export completed links to CSV"
              >
                Export URLs
              </button>
              <button
                onClick={onOpenHailuo}
                className="text-xs text-gray-400 hover:text-white border border-white/10 px-3 py-1.5 rounded-xl hover:bg-white/[0.02] transition-all"
              >
                Open Hailuo
              </button>
              <button
                onClick={onClear}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 px-3 py-1.5 rounded-xl hover:bg-red-950/20 transition-all"
              >
                Clear
              </button>
              <button
                onClick={() => setShowModelPicker(true)}
                disabled={readyCount === 0}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold shadow-lg shadow-violet-950/30"
              >
                Generate All ({readyCount})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-6 relative z-10">
        {/* Statistics Metric Bar */}
        <StatsBar shots={shots} selectedModel={selectedModel} />

        {activeTab === 'timeline' ? (
          /* TIMELINE VIEW (3-Pane Layout) */
          <div className="flex-1 flex overflow-hidden gap-6">
            
            {/* LEFT SIDEBAR — Shot List */}
            <div className="w-72 glass-panel rounded-2xl border border-white/5 flex flex-col overflow-hidden">
              <div className="px-4 py-3 bg-white/[0.01] border-b border-white/5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Storyboard Sequence</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
                {shots.map((shot) => (
                  <div
                    key={shot.id}
                    onClick={() => setSelectedId(shot.id)}
                    className={`group flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all border-l-2
                      ${
                        shot.id === selectedId
                          ? 'bg-violet-950/15 border-l-violet-500 bg-white/[0.02]'
                          : 'border-l-transparent hover:bg-white/[0.01]'
                      }`}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot(shot)}`} />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs font-semibold text-gray-200">Shot {shot.shotNumber}</p>
                        {shot.status === 'error' && !isRunning && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedModel) retryShot(shot, selectedModel);
                              else setShowModelPicker(true);
                            }}
                            className="hidden group-hover:flex items-center text-[10px] text-violet-400 hover:text-white"
                            title="Retry Generation"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 truncate leading-tight">
                        {shot.status === 'generating' && shot.progress
                          ? shot.progress
                          : shot.status === 'error'
                          ? shot.errorMsg
                          : shot.visualDescription || 'No description'}
                      </p>
                    </div>
                    {shot.imagePreview && (
                      <img src={shot.imagePreview} className="w-9 h-6.5 object-cover rounded border border-white/10 group-hover:hidden" alt="" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteShot(shot.id); }}
                      disabled={isRunning}
                      className="hidden group-hover:flex items-center justify-center w-6 h-6 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-950/20 transition-all flex-shrink-0 disabled:opacity-40"
                      title="Delete shot"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* MAIN PANEL — Focused Shot Editor */}
            <div className="flex-1 flex flex-col overflow-y-auto pr-1">
              <div className="space-y-6 max-w-4xl">
                
                {/* Shot Header Panel */}
                <div className="flex items-center justify-between bg-white/[0.01] glass-panel rounded-2xl p-4 border border-white/5">
                  <div>
                    <h2 className="text-lg font-bold text-white">Shot {selected.shotNumber}</h2>
                    <span className="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-900/20 text-violet-400 border border-violet-800/30">
                      {selected.assetType || 'Video Shot'}
                    </span>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const idx = shots.findIndex((s) => s.id === selectedId);
                        if (idx > 0) setSelectedId(shots[idx - 1].id);
                      }}
                      disabled={shots.findIndex((s) => s.id === selectedId) === 0}
                      className="text-xs px-3.5 py-1.5 border border-white/10 hover:border-violet-500/50 rounded-xl hover:bg-white/[0.02] text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                    >
                      &larr; Prev
                    </button>
                    <button
                      onClick={() => {
                        const idx = shots.findIndex((s) => s.id === selectedId);
                        if (idx < shots.length - 1) setSelectedId(shots[idx + 1].id);
                      }}
                      disabled={shots.findIndex((s) => s.id === selectedId) === shots.length - 1}
                      className="text-xs px-3.5 py-1.5 border border-white/10 hover:border-violet-500/50 rounded-xl hover:bg-white/[0.02] text-gray-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                    >
                      Next &rarr;
                    </button>
                    <button
                      onClick={() => deleteShot(selected.id)}
                      disabled={isRunning}
                      className="text-xs px-3.5 py-1.5 border border-red-500/20 text-red-400 rounded-xl hover:bg-red-950/25 hover:text-red-300 disabled:opacity-40 transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Automation States (Done, Error, Generating) */}
                {selected.status === 'done' && selected.videoUrl && (
                  <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-2xl px-5 py-4 flex items-center gap-4 animate-fade-in">
                    <div className="w-7 h-7 bg-emerald-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-emerald-400">Video Rendered Successfully</p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{selected.videoUrl}</p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={selected.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={`shot-${selected.shotNumber}.mp4`}
                        className="text-xs text-violet-400 hover:text-white border border-violet-500/20 hover:border-violet-500/50 px-3 py-1.5 rounded-xl hover:bg-violet-950/10 transition-colors"
                      >
                        Open Video
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selected.videoUrl!);
                          addLog(`Copied Video URL for Shot ${selected.shotNumber}`, 'success');
                        }}
                        className="text-xs text-gray-400 hover:text-white border border-white/10 px-3 py-1.5 rounded-xl hover:bg-white/[0.02] transition-colors"
                      >
                        Copy URL
                      </button>
                    </div>
                  </div>
                )}

                {selected.status === 'error' && (
                  <div className="bg-red-950/20 border border-red-500/20 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 animate-fade-in">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 bg-red-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-red-400">Automation Render Error</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{selected.errorMsg}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (selectedModel) retryShot(selected, selectedModel);
                        else setShowModelPicker(true);
                      }}
                      className="text-xs bg-red-900/20 border border-red-500/30 text-red-300 hover:text-white px-4 py-2 rounded-xl hover:bg-red-950/20 transition-all font-semibold"
                    >
                      Retry Shot
                    </button>
                  </div>
                )}

                {selected.status === 'generating' && (
                  <div className="bg-blue-950/20 border border-blue-500/20 rounded-2xl px-5 py-4 flex items-center gap-3 animate-fade-in">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <p className="text-xs text-blue-400 font-semibold">{selected.progress || 'Processing in background...'}</p>
                  </div>
                )}

                {/* 16:9 Image Reference Canvas */}
                <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                  <div className="px-4 py-3 bg-white/[0.01] border-b border-white/5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-gray-300">Reference Image</p>
                      <p className="text-[10px] text-violet-400/80 mt-0.5">Auto center-cropped to 16:9 cinematic aspect ratio. Paste image using Ctrl+V.</p>
                    </div>
                    {selected.imagePreview && (
                      <button
                        onClick={() =>
                          updateShot(selected.id, { imageBase64: null, imagePreview: null })
                        }
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {selected.imagePreview ? (
                    <div
                      className="relative w-full cursor-pointer group"
                      style={{ paddingBottom: '56.25%' }}
                      onClick={() => document.getElementById(`img-input-${selected.id}`)?.click()}
                    >
                      <img
                        src={selected.imagePreview}
                        alt="Storyboard Frame"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/60 px-4 py-2 rounded-xl border border-white/10">
                          Change Reference Frame
                        </span>
                      </div>
                      <input
                        id={`img-input-${selected.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageFile(f);
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      onDrop={handleImageDrop}
                      onDragOver={(e) => { e.preventDefault(); setImageDragging(true); }}
                      onDragLeave={() => setImageDragging(false)}
                      onClick={() => document.getElementById(`img-input-${selected.id}`)?.click()}
                      className={`relative w-full cursor-pointer transition-all duration-300 ${
                        imageDragging ? 'bg-violet-950/20' : 'bg-white/[0.01] hover:bg-white/[0.02]'
                      }`}
                      style={{ paddingBottom: '56.25%' }}
                    >
                      <input
                        id={`img-input-${selected.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageFile(f);
                        }}
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <div className="w-12 h-12 bg-white/[0.03] border border-white/10 rounded-2xl flex items-center justify-center shadow-inner">
                          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-gray-300">Drop an image here</p>
                          <p className="text-xs text-gray-500 mt-1">or click to browse your computer</p>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[10px] bg-white/[0.02] border border-white/5 px-2 py-0.5 rounded text-gray-400">Ctrl+V Paste</span>
                          <span className="text-[10px] bg-violet-950/30 border border-violet-850/30 px-2 py-0.5 rounded text-violet-400">16:9 Aspect Ratio</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Detail Form Fields */}
                <div className="glass-panel rounded-2xl border border-white/5 p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-wide">
                        Asset Type
                      </label>
                      <input
                        type="text"
                        value={selected.assetType || ''}
                        onChange={(e) => updateShot(selected.id, { assetType: e.target.value })}
                        className="w-full text-sm glass-input rounded-xl px-3.5 py-2.5"
                        placeholder="e.g. Video, Image"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-wide">
                        Text On Screen
                      </label>
                      <input
                        type="text"
                        value={selected.textOnScreen || ''}
                        onChange={(e) => updateShot(selected.id, { textOnScreen: e.target.value })}
                        className="w-full text-sm glass-input rounded-xl px-3.5 py-2.5"
                        placeholder="e.g. Text overlays"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-wide">
                      Visual Description
                    </label>
                    <textarea
                      value={selected.visualDescription || ''}
                      onChange={(e) => updateShot(selected.id, { visualDescription: e.target.value })}
                      rows={2}
                      className="w-full text-sm glass-input rounded-xl px-3.5 py-2.5 resize-none"
                      placeholder="Detail the shot visuals..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-wide">
                      Narration (Voice Over)
                    </label>
                    <textarea
                      value={selected.narration || ''}
                      onChange={(e) => updateShot(selected.id, { narration: e.target.value })}
                      rows={2}
                      className="w-full text-sm glass-input rounded-xl px-3.5 py-2.5 resize-none"
                      placeholder="Script for the narrator..."
                    />
                  </div>

                  {/* PROMPT EDITOR */}
                  <div className="pt-2 border-t border-white/[0.03]">
                    <label className="block text-[10px] font-bold text-violet-400 mb-1.5 uppercase tracking-wide flex items-center gap-1">
                      Video Prompt <span className="text-[9px] text-gray-500 font-normal lowercase">(sent to Hailuo AI prompt editor)</span>
                    </label>
                    <textarea
                      value={selected.prompt || ''}
                      onChange={(e) => updateShot(selected.id, { prompt: e.target.value })}
                      rows={4}
                      placeholder="Write the full AI video generation prompt here..."
                      className="w-full text-sm glass-input border-violet-500/20 bg-violet-950/5 rounded-xl px-3.5 py-2.5 resize-none focus:border-violet-500/50"
                    />
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[10px] text-gray-500">{(selected.prompt || '').length} characters</span>
                      {!selected.prompt && (
                        <span className="text-[10px] text-yellow-500/80">Prompt required for automation</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Save & Next Control */}
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      updateShot(selected.id, { status: 'ready' });
                      const idx = shots.findIndex((s) => s.id === selectedId);
                      if (idx < shots.length - 1) setSelectedId(shots[idx + 1].id);
                    }}
                    disabled={!selected.imagePreview || !selected.prompt}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs px-6 py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed font-semibold shadow-lg shadow-violet-950/20 transition-all"
                  >
                    Save &amp; Proceed &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* STORYBOARD GRID VIEW */
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-6">
              {shots.map((shot) => (
                <div
                  key={shot.id}
                  onClick={() => {
                    setSelectedId(shot.id);
                    setActiveTab('timeline');
                  }}
                  className="glass-panel glass-panel-hover rounded-2xl overflow-hidden border border-white/5 cursor-pointer flex flex-col animate-fade-in"
                >
                  {/* Thumbnail area */}
                  <div className="relative aspect-video bg-black/40 border-b border-white/5 flex items-center justify-center">
                    {shot.imagePreview ? (
                      <img src={shot.imagePreview} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-gray-600">
                        <svg className="w-8 h-8 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                        </svg>
                        <span className="text-[9px] uppercase tracking-wider font-semibold">No Frame</span>
                      </div>
                    )}
                    
                    <span className="absolute top-2.5 left-2.5 bg-black/75 backdrop-blur-sm text-[10px] font-bold text-gray-200 px-2 py-0.5 rounded-lg border border-white/10">
                      Shot {shot.shotNumber}
                    </span>
                  </div>

                  {/* Info area */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] text-gray-500 font-semibold truncate max-w-[120px]">
                          {shot.assetType || 'Video Shot'}
                        </span>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${getStatusBadgeColor(shot)}`}>
                          {getStatusText(shot)}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-300 line-clamp-3 leading-relaxed">
                        {shot.prompt || shot.visualDescription || 'No prompt or description added.'}
                      </p>
                    </div>

                    {shot.videoUrl && (
                      <div className="mt-3 pt-2.5 border-t border-white/5 flex justify-end">
                        <a
                          href={shot.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-violet-400 hover:text-white font-semibold flex items-center gap-1"
                        >
                          View Video &rarr;
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Embedded Real-time Console Log Terminal */}
        <TerminalLog logs={logs} onClear={clearLogs} />
      </div>

      {/* Model Selector Dialog */}
      {showModelPicker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="glass-panel border border-white/10 rounded-2xl shadow-2xl w-[480px] p-6 max-w-full m-4">
            <h2 className="text-base font-bold text-white mb-1">Select Video Generator Model</h2>
            <p className="text-xs text-gray-400 mb-5">Choose the model to use for all {readyCount} shots. LuoFlow will configure this choice automatically on Hailuo.</p>
            
            <div className="grid grid-cols-1 gap-3 mb-6">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={`text-left rounded-xl border-2 p-3 transition-all cursor-pointer flex justify-between items-center
                    ${selectedModel === m.id 
                      ? 'border-violet-500 bg-violet-950/15 shadow-[0_0_15px_rgba(139,92,246,0.15)]' 
                      : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'}`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-white truncate">{m.label}</span>
                      {m.badge && (
                        <span className="text-[8px] bg-violet-900/40 text-violet-300 border border-violet-850 px-1 py-0.5 rounded font-bold uppercase tracking-wider">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 leading-tight">{m.desc}</p>
                  </div>
                  <span className="text-[9px] bg-white/[0.03] border border-white/5 text-gray-400 px-2 py-1 rounded-lg font-mono flex-shrink-0">
                    {m.specs}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-3 border-t border-white/5 pt-4">
              <button
                onClick={() => setShowModelPicker(false)}
                className="text-xs text-gray-400 hover:text-white border border-white/10 px-4 py-2 rounded-xl hover:bg-white/[0.02] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => selectedModel && runGeneration(selectedModel)}
                disabled={!selectedModel}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs px-5 py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed font-semibold shadow-lg shadow-violet-950/30"
              >
                Start Generation Run ({readyCount})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

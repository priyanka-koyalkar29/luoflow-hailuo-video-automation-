import { useEffect, useRef, useState } from 'react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

export default function TerminalLog({ logs, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (containerRef.current && !collapsed) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, collapsed]);

  const handleExport = () => {
    if (logs.length === 0) return;
    const text = logs
      .map((log) => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luoflow-execution-log-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return 'text-emerald-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      default:
        return 'text-purple-300';
    }
  };

  return (
    <div className="glass-panel rounded-xl overflow-hidden border border-white/5 flex flex-col mt-6 transition-all duration-300">
      {/* Console Header */}
      <div className="bg-black/40 px-4 py-2 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
          </span>
          <span className="text-xs font-mono font-bold text-gray-300 tracking-wider">LUOFLOW://EXECUTION_LOG</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={logs.length === 0}
            className="text-[10px] font-mono text-gray-400 hover:text-white px-2 py-0.5 rounded border border-white/10 hover:border-violet-500/50 disabled:opacity-40 transition-colors"
            title="Export logs as txt"
          >
            EXPORT_LOGS
          </button>
          <button
            onClick={onClear}
            className="text-[10px] font-mono text-gray-400 hover:text-red-400 px-2 py-0.5 rounded border border-white/10 hover:border-red-500/30 transition-colors"
          >
            CLEAR
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transform transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Console Output */}
      {!collapsed && (
        <div
          ref={containerRef}
          className="bg-black/60 p-4 h-40 overflow-y-auto font-mono text-xs leading-relaxed space-y-1.5 scrollbar-thin"
        >
          {logs.length === 0 ? (
            <p className="text-gray-500 italic">No logs recorded. Storyboard generation operations will show logs here...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="flex gap-2 items-start animate-fade-in">
                <span className="text-gray-600 select-none">[{log.timestamp}]</span>
                <span className={`${getTypeColor(log.type)}`}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

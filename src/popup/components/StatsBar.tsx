import { Shot } from '../../types';

interface Props {
  shots: Shot[];
  selectedModel: string | null;
}

export default function StatsBar({ shots, selectedModel }: Props) {
  const total = shots.length;
  const completed = shots.filter((s) => s.status === 'done').length;
  const failed = shots.filter((s) => s.status === 'error').length;
  const generating = shots.filter((s) => s.status === 'generating').length;
  
  // Calculate success rate based on attempted shots (completed + failed)
  const attempted = completed + failed;
  const successRate = attempted > 0 ? Math.round((completed / attempted) * 100) : 0;

  // Calculate estimated runtime:
  // Hailuo 2.3-Fast: ~2 mins per shot (120s)
  // Hailuo 2.0: ~4 mins per shot (240s)
  // Hailuo 1.0-Director: ~3 mins per shot (180s)
  // Default: ~2.5 mins (150s)
  const getSecondsPerShot = (model: string | null) => {
    if (!model) return 150;
    if (model.includes('Fast')) return 120;
    if (model.includes('2.0')) return 240;
    if (model.includes('Director')) return 180;
    return 150;
  };

  const secondsPerShot = getSecondsPerShot(selectedModel);
  const remainingShots = shots.filter((s) => s.status !== 'done').length;
  const estSeconds = remainingShots * secondsPerShot;
  
  const formatTime = (totalSeconds: number) => {
    if (totalSeconds <= 0) return '0s';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
      {/* Total Shots */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-violet-400 font-semibold tracking-wider uppercase">Total Shots</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-2xl font-bold text-white">{total}</span>
          <span className="text-xs text-gray-500">shots</span>
        </div>
      </div>

      {/* Completed */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-emerald-400 font-semibold tracking-wider uppercase">Completed</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-2xl font-bold text-emerald-400">{completed}</span>
          <span className="text-xs text-gray-500">done</span>
        </div>
      </div>

      {/* Failed */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-red-400 font-semibold tracking-wider uppercase">Failed</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-2xl font-bold text-red-400">{failed}</span>
          <span className="text-xs text-gray-500">errors</span>
        </div>
      </div>

      {/* Success Rate */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-cyan-400 font-semibold tracking-wider uppercase">Success Rate</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-2xl font-bold text-cyan-400">{successRate}%</span>
          <span className="text-xs text-gray-500">ratio</span>
        </div>
      </div>

      {/* Est Runtime */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-purple-400 font-semibold tracking-wider uppercase">Est. Runtime</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-sm font-bold text-purple-300 truncate w-full" title={formatTime(estSeconds)}>
            {formatTime(estSeconds)}
          </span>
        </div>
      </div>

      {/* Active State */}
      <div className="glass-panel rounded-xl p-3 flex flex-col justify-between border border-white/5">
        <span className="text-[10px] text-yellow-400 font-semibold tracking-wider uppercase">Queue Status</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          {generating > 0 ? (
            <span className="text-xs font-bold text-yellow-400 animate-pulse">
              Running ({generating})
            </span>
          ) : (
            <span className="text-xs font-bold text-gray-400">
              Idle
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

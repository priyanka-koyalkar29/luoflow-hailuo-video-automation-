import { useCallback, useState } from 'react';
import * as XLSX from 'xlsx';
import type { Shot } from '../../types';

interface Props {
  onShotsLoaded: (shots: Shot[]) => void;
}

// Flexible column finder — matches any variation of column name
const col = (row: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const found = Object.keys(row).find(
      (rk) => rk.trim().toLowerCase() === k.toLowerCase()
    );
    if (found && row[found] !== undefined && row[found] !== '') {
      return String(row[found]);
    }
  }
  return '';
};

export default function UploadScreen({ onShotsLoaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const parseExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (rows.length === 0) {
          setError('Excel file is empty or has no data rows.');
          return;
        }

        const shots: Shot[] = rows.map((row, i) => ({
          id: String(i + 1),
          shotNumber:
            col(row, 'Shot Number', 'shot_number', 'Shot No', 'ShotNumber', 'shot no') ||
            String(i + 1),
          narration: col(row, 'Narration', 'narration', 'Narration Text'),
          textOnScreen: col(
            row,
            'Text on Screen',
            'text_on_screen',
            'Text On Screen',
            'TextOnScreen',
            'text on screen'
          ),
          visualDescription: col(
            row,
            'Visual Description',
            'visual_description',
            'Visual',
            'visual description'
          ),
          shotDescription: col(
            row,
            'Shot Description',
            'shot_description',
            'Shot Desc',
            'shot description'
          ),
          assetType: col(row, 'Asset Type', 'asset_type', 'AssetType', 'asset type', 'Type'),
          prompt: col(
            row,
            'Prompt',
            'prompt',
            'Video Prompt',
            'video_prompt',
            'video prompt',
            'Hailuo Prompt',
            'hailuo_prompt'
          ),
          imageBase64: null,
          imagePreview: null,
          status: 'pending',
        }));

        // Filter out completely empty shots
        const validShots = shots.filter(s => s.prompt || s.visualDescription);
        
        if (validShots.length === 0) {
          setError('No valid storyboard rows found. Each row needs at least a "Prompt" or "Visual Description".');
          return;
        }

        onShotsLoaded(validShots);
      } catch {
        setError('Could not read Excel file. Make sure it\'s a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseExcel(file);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseExcel(file);
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const file = e.clipboardData.files[0];
    if (file) parseExcel(file);
  }, []);

  const downloadTemplate = () => {
    const headers = [
      'Shot Number',
      'Asset Type',
      'Visual Description',
      'Narration',
      'Text on Screen',
      'Prompt'
    ];
    const sampleRows = [
      {
        'Shot Number': '1',
        'Asset Type': 'Video',
        'Visual Description': 'A wide shot of a futuristic neon city under rain, reflections on wet asphalt',
        'Narration': 'The year was 2084, and the rain never truly stopped.',
        'Text on Screen': 'NEO-SEOUL 2084',
        'Prompt': 'A cinematic wide shot of a cyberpunk city under heavy rain, towering skyscrapers with glowing purple neon signs, reflections on wet streets, movie cinematic lighting'
      },
      {
        'Shot Number': '2',
        'Asset Type': 'Video',
        'Visual Description': 'Medium shot of a detective cyborg standing under a flickering billboard light',
        'Narration': 'In the shadows of the city, some secrets refused to stay buried.',
        'Text on Screen': '',
        'Prompt': 'Medium close up shot of a rugged detective cyborg wearing a dark futuristic trench coat, standing under flickering light, dramatic shadows, realistic eyes, cinematic look'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Storyboard');
    XLSX.writeFile(wb, 'LuoFlow_Storyboard_Template.xlsx');
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#0b0a0f] relative overflow-hidden"
      onPaste={handlePaste}
    >
      {/* Decorative Radial Background */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[300px] h-[300px] bg-indigo-600/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="mb-10 text-center relative z-10 animate-fade-in">
        <div className="inline-flex items-center gap-2 bg-violet-950/50 border border-violet-800/40 text-violet-300 px-4 py-1.5 rounded-full text-xs font-semibold mb-4">
          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-ping"></span>
          LuoFlow — Internship Project Refinement
        </div>
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-violet-200 to-indigo-200 mb-3 tracking-tight">
          Upload Your Storyboard
        </h1>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          Convert Excel spreadsheet shot plans into automated Hailuo AI video generations.
        </p>
      </div>

      <div className="w-full max-w-xl relative z-10 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        {/* Drag & Drop Card */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300
            ${
              dragging
                ? 'border-violet-500 bg-violet-950/20 shadow-[0_0_30px_rgba(139,92,246,0.1)]'
                : 'border-white/10 bg-white/[0.02] hover:border-violet-500/50 hover:bg-white/[0.04]'
            }`}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
          <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-inner">
            <svg
              className="w-8 h-8 text-violet-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-gray-200 mb-1">
            Drag and drop your spreadsheet here
          </p>
          <p className="text-xs text-gray-500 mb-6">
            Supports Excel sheets (.xlsx, .xls)
          </p>
          <button className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium rounded-xl text-xs shadow-lg shadow-violet-950/30 transition-all">
            Browse File
          </button>
        </div>

        {error && (
          <div className="mt-4 text-xs text-red-400 bg-red-950/30 border border-red-900/40 px-4 py-3 rounded-xl animate-fade-in flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Info & Template Exporter */}
        <div className="mt-8 glass-panel rounded-xl p-4 border border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-300">Need a storyboard template?</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Download our pre-structured spreadsheet format with matching automation headers.
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadTemplate();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 hover:border-violet-500/50 bg-white/[0.02] text-[11px] font-medium text-violet-300 rounded-lg hover:text-white transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Template
          </button>
        </div>
      </div>
      
      <p className="mt-10 text-[11px] text-gray-600 relative z-10">
        All video files and reference images are processed securely inside your browser.
      </p>
    </div>
  );
}

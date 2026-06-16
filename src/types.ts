export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface Shot {
  id: string;
  shotNumber: string;
  narration: string;
  textOnScreen: string;
  visualDescription: string;
  shotDescription: string;
  assetType: string;
  prompt: string;
  imageBase64: string | null;   // base64 data URL (no File objects — can't serialize)
  imagePreview: string | null;
  status: 'pending' | 'ready' | 'generating' | 'done' | 'error';
  errorMsg?: string;
  videoUrl?: string;
  progress?: string;
}

export type Screen = 'upload' | 'review';

// Messages popup → background (via port)
export type PopupMsg =
  | { type: 'GENERATE'; shot: { id: string; prompt: string; imageBase64: string | null; model: string } }
  | { type: 'CANCEL'; shotId: string };

// Messages background → popup (via port)
export type BackgroundMsg =
  | { type: 'SHOT_PROGRESS'; shotId: string; step: string }
  | { type: 'SHOT_DONE'; shotId: string; videoUrl: string }
  | { type: 'SHOT_ERROR'; shotId: string; error: string };

// Content script → background (via runtime.sendMessage)
export interface ApiResponseMsg {
  type: 'API_RESPONSE';
  url: string;
  method: string;
  data: unknown;
}


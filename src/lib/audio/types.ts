export type ResolvedTheme = 'light' | 'dark';
export type WaveformMode = 'combined' | 'split';
export type SpectrogramMode = 'combined' | 'lr' | 'ms';
export type AnalysisChannel = 'combined' | 'left' | 'right' | 'mid' | 'side';
export type AnalysisStage = 'starting' | 'transferring' | 'analyzing' | 'finalizing';
export type AnalysisQuality = 'efficient' | 'high' | 'maximum';

export interface AnalysisCapabilities {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
}

export interface AnalysisPlan {
  fftSize: number;
  binCount: number;
  maxFrames: number;
  frameCount: number;
  quality: AnalysisQuality;
  estimatedOutputBytes: number;
  estimatedWorkerBytes: number;
}

export interface OfflineAnalysis {
  channels: Record<AnalysisChannel, Float32Array>;
  frameCount: number;
  binCount: number;
  duration: number;
  sampleRate: number;
  minDb: number;
  maxDb: number;
}

export interface AnalysisProgress {
  stage: AnalysisStage;
  progress: number;
  frame: number;
  totalFrames: number;
  elapsedMs: number;
}

export interface PeakSeries {
  min: Float32Array;
  max: Float32Array;
}

export interface WaveformData {
  left: PeakSeries;
  right: PeakSeries;
  combined: PeakSeries;
}

export interface DecodedAudio {
  buffer: AudioBuffer;
  waveform: WaveformData;
  analysis?: OfflineAnalysis;
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface AnalyzerBank {
  left: AnalyserNode;
  right: AnalyserNode;
  mid: AnalyserNode;
  side: AnalyserNode;
}

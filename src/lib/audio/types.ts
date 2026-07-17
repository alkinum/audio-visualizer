export type ResolvedTheme = 'light' | 'dark';
export type WaveformMode = 'combined' | 'split';
export type SpectrogramMode = 'combined' | 'lr' | 'ms';
export type AnalysisChannel = 'combined' | 'left' | 'right' | 'mid' | 'side';

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

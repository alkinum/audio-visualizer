export interface AudioData {
  audioBuffer: AudioBuffer;
  waveformData: {
    left: number[];
    right: number[];
    combined: number[];
  };
  spectrumData: number[][];
}

export interface VisualizationProps {
  data: number[] | number[][] | { left: number[]; right: number[]; combined: number[] };
  height: number;
  color: string;
  gradientColor?: string;
  currentTime?: number;
  duration?: number;
  showChannels?: 'combined' | 'separate';
  type?: 'waveform' | 'spectrum';
}

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  showChannels: 'combined' | 'separate';
}
import type { AnalyzerBank, PlaybackSnapshot } from './types';

const ANALYZER_FFT_SIZE = 4096;
const MATRIX_GAIN = Math.SQRT1_2;

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private output: GainNode | null = null;
  private silentSink: GainNode | null = null;
  private analyzerBank: AnalyzerBank | null = null;
  private offset = 0;
  private startedAt = 0;
  private playing = false;

  constructor(
    private readonly buffer: AudioBuffer,
    private readonly onEnded: () => void,
  ) {}

  get analyzers(): AnalyzerBank | null {
    return this.analyzerBank;
  }

  get snapshot(): PlaybackSnapshot {
    return {
      isPlaying: this.playing,
      currentTime: this.currentTime,
      duration: this.buffer.duration,
    };
  }

  get currentTime(): number {
    if (!this.playing || !this.context) {
      return this.offset;
    }

    return Math.min(this.buffer.duration, this.offset + this.context.currentTime - this.startedAt);
  }

  async toggle(): Promise<PlaybackSnapshot> {
    if (this.playing) {
      this.pause();
    } else {
      await this.play();
    }

    return this.snapshot;
  }

  async play(): Promise<void> {
    const context = this.ensureGraph();
    await context.resume();

    if (this.offset >= this.buffer.duration - 0.01) {
      this.offset = 0;
    }

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output!);
    source.connect(this.splitter!);
    source.onended = () => {
      if (this.source !== source || !this.playing) return;
      this.source = null;
      this.playing = false;
      this.offset = 0;
      this.onEnded();
    };

    this.source = source;
    this.startedAt = context.currentTime;
    this.playing = true;
    source.start(0, this.offset);
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.playing = false;
    this.stopSource();
  }

  async seek(time: number): Promise<PlaybackSnapshot> {
    const wasPlaying = this.playing;
    this.playing = false;
    this.stopSource();
    this.offset = Math.max(0, Math.min(time, this.buffer.duration));

    if (wasPlaying) {
      await this.play();
    }

    return this.snapshot;
  }

  async destroy(): Promise<void> {
    this.playing = false;
    this.stopSource();
    const context = this.context;
    this.context = null;
    this.analyzerBank = null;
    this.splitter = null;
    this.output = null;
    this.silentSink = null;

    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }

  private stopSource(): void {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  private ensureGraph(): AudioContext {
    if (this.context) return this.context;

    const context = new AudioContext({ latencyHint: 'interactive' });
    const splitter = context.createChannelSplitter(2);
    const output = context.createGain();
    const silentSink = context.createGain();
    silentSink.gain.value = 0;

    const left = this.createAnalyzer(context);
    const right = this.createAnalyzer(context);
    const mid = this.createAnalyzer(context);
    const side = this.createAnalyzer(context);
    const rightOutput = this.buffer.numberOfChannels > 1 ? 1 : 0;

    splitter.connect(left, 0);
    splitter.connect(right, rightOutput);

    const midLeft = context.createGain();
    const midRight = context.createGain();
    const sideLeft = context.createGain();
    const sideRight = context.createGain();
    midLeft.gain.value = MATRIX_GAIN;
    midRight.gain.value = MATRIX_GAIN;
    sideLeft.gain.value = MATRIX_GAIN;
    sideRight.gain.value = -MATRIX_GAIN;

    splitter.connect(midLeft, 0);
    splitter.connect(midRight, rightOutput);
    splitter.connect(sideLeft, 0);
    splitter.connect(sideRight, rightOutput);
    midLeft.connect(mid);
    midRight.connect(mid);
    sideLeft.connect(side);
    sideRight.connect(side);

    left.connect(silentSink);
    right.connect(silentSink);
    mid.connect(silentSink);
    side.connect(silentSink);
    silentSink.connect(context.destination);
    output.connect(context.destination);

    this.context = context;
    this.splitter = splitter;
    this.output = output;
    this.silentSink = silentSink;
    this.analyzerBank = { left, right, mid, side };
    return context;
  }

  private createAnalyzer(context: AudioContext): AnalyserNode {
    const analyzer = context.createAnalyser();
    analyzer.fftSize = ANALYZER_FFT_SIZE;
    analyzer.minDecibels = -120;
    analyzer.maxDecibels = 0;
    analyzer.smoothingTimeConstant = 0.78;
    return analyzer;
  }
}

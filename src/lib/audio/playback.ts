import type {
  AnalyzerBank,
  AuditionChannel,
  AuditionFilterMode,
  ComparisonSlot,
  PlaybackSnapshot,
} from './types';

const ANALYZER_FFT_SIZE = 8192;
const MATRIX_GAIN = Math.SQRT1_2;
const SOURCE_SWITCH_SECONDS = 0.008;

export class PlaybackEngine {
  private context: AudioContext | null = null;
  private sources: Record<ComparisonSlot, AudioBufferSourceNode | null> = { a: null, b: null };
  private comparisonBuffer: AudioBuffer | null;
  private activeComparisonSlot: ComparisonSlot = 'a';
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private auditionChannel: AuditionChannel = 'stereo';
  private auditionFilter: AuditionFilterMode = 'off';
  private channelGains: Record<AuditionChannel, GainNode> | null = null;
  private filterGains: Record<AuditionFilterMode, GainNode> | null = null;
  private highpassNode: BiquadFilterNode | null = null;
  private lowpassNode: BiquadFilterNode | null = null;
  private highpassFrequency = 10_000;
  private lowpassFrequency = 250;
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
    comparisonBuffer: AudioBuffer | null = null,
  ) {
    this.comparisonBuffer = comparisonBuffer;
  }

  get analyzers(): AnalyzerBank | null {
    return this.analyzerBank;
  }

  get activeSlot(): ComparisonSlot {
    return this.activeComparisonSlot;
  }

  get hasComparison(): boolean {
    return Boolean(this.comparisonBuffer);
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? this.buffer.sampleRate;
  }

  get snapshot(): PlaybackSnapshot {
    return {
      isPlaying: this.playing,
      currentTime: this.currentTime,
      duration: this.buffer.duration,
    };
  }

  get currentTime(): number {
    if (!this.playing || !this.context) return this.offset;
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

    if (this.offset >= this.buffer.duration - 0.01) this.offset = 0;

    this.stopSources();
    this.startedAt = context.currentTime;
    this.playing = true;
    this.sources.a = this.startSource('a', this.buffer, this.offset);
    if (this.comparisonBuffer && this.offset < this.comparisonBuffer.duration) {
      this.sources.b = this.startSource('b', this.comparisonBuffer, this.offset);
    }
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.playing = false;
    this.stopSources();
  }

  async seek(time: number): Promise<PlaybackSnapshot> {
    const wasPlaying = this.playing;
    this.playing = false;
    this.stopSources();
    this.offset = Math.max(0, Math.min(time, this.buffer.duration));

    if (wasPlaying) await this.play();
    return this.snapshot;
  }

  setActiveSlot(slot: ComparisonSlot): PlaybackSnapshot {
    if (slot === 'b' && !this.comparisonBuffer) return this.snapshot;
    this.activeComparisonSlot = slot;
    this.applyActiveGains(false);
    return this.snapshot;
  }

  setComparisonBuffer(buffer: AudioBuffer | null): PlaybackSnapshot {
    const currentTime = this.currentTime;
    this.stopSource('b');
    this.comparisonBuffer = buffer;

    if (!buffer && this.activeComparisonSlot === 'b') {
      this.activeComparisonSlot = 'a';
      this.applyActiveGains(false);
    } else if (buffer && this.playing && currentTime < buffer.duration) {
      this.sources.b = this.startSource('b', buffer, currentTime);
    }

    return this.snapshot;
  }

  setAuditionChannel(channel: AuditionChannel): PlaybackSnapshot {
    this.auditionChannel = channel;
    this.applyAuditionChannel(false);
    return this.snapshot;
  }

  setAuditionFilter(mode: AuditionFilterMode, frequency?: number): PlaybackSnapshot {
    this.auditionFilter = mode;
    if (Number.isFinite(frequency)) {
      if (mode === 'highpass') this.highpassFrequency = frequency!;
      if (mode === 'lowpass') this.lowpassFrequency = frequency!;
    }
    this.updateFilterFrequencies();
    this.applyAuditionFilter(false);
    return this.snapshot;
  }

  async destroy(): Promise<void> {
    this.playing = false;
    this.stopSources();
    const context = this.context;
    this.context = null;
    this.analyzerBank = null;
    this.gainA = null;
    this.gainB = null;
    this.channelGains = null;
    this.filterGains = null;
    this.highpassNode = null;
    this.lowpassNode = null;
    this.splitter = null;
    this.output = null;
    this.silentSink = null;

    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }

  private startSource(slot: ComparisonSlot, buffer: AudioBuffer, offset: number): AudioBufferSourceNode {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(slot === 'a' ? this.gainA! : this.gainB!);
    source.onended = () => {
      if (this.sources[slot] !== source) return;
      this.sources[slot] = null;
      if (slot === 'a' && this.playing) this.finishPlayback();
    };
    source.start(0, offset);
    return source;
  }

  private finishPlayback(): void {
    this.playing = false;
    this.offset = 0;
    this.stopSource('b');
    this.onEnded();
  }

  private stopSources(): void {
    this.stopSource('a');
    this.stopSource('b');
  }

  private stopSource(slot: ComparisonSlot): void {
    const source = this.sources[slot];
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
    this.sources[slot] = null;
  }

  private ensureGraph(): AudioContext {
    if (this.context) return this.context;

    const context = new AudioContext({ latencyHint: 'interactive' });
    const gainA = context.createGain();
    const gainB = context.createGain();
    const sourceBus = context.createGain();
    sourceBus.channelCount = 2;
    sourceBus.channelCountMode = 'explicit';
    sourceBus.channelInterpretation = 'speakers';
    const sourceSplitter = context.createChannelSplitter(2);
    const auditionBus = context.createGain();
    const output = context.createGain();
    output.channelCount = 2;
    output.channelCountMode = 'explicit';
    output.channelInterpretation = 'speakers';
    const splitter = context.createChannelSplitter(2);
    const silentSink = context.createGain();
    silentSink.gain.value = 0;

    gainA.connect(sourceBus);
    gainB.connect(sourceBus);
    sourceBus.connect(sourceSplitter);

    const stereoGain = this.connectStereoMode(context, sourceSplitter, auditionBus);
    const leftGain = this.connectMonoMode(context, sourceSplitter, 0, 1, auditionBus);
    const rightGain = this.connectMonoMode(context, sourceSplitter, 1, 1, auditionBus);
    const midGain = this.connectMatrixMode(context, sourceSplitter, 0.5, 0.5, auditionBus);
    const sideGain = this.connectMatrixMode(context, sourceSplitter, 0.5, -0.5, auditionBus);

    const dryGain = context.createGain();
    const highpassGain = context.createGain();
    const lowpassGain = context.createGain();
    const highpassNode = context.createBiquadFilter();
    const lowpassNode = context.createBiquadFilter();
    highpassNode.type = 'highpass';
    highpassNode.Q.value = Math.SQRT1_2;
    lowpassNode.type = 'lowpass';
    lowpassNode.Q.value = Math.SQRT1_2;
    auditionBus.connect(dryGain);
    auditionBus.connect(highpassNode);
    auditionBus.connect(lowpassNode);
    highpassNode.connect(highpassGain);
    lowpassNode.connect(lowpassGain);
    dryGain.connect(output);
    highpassGain.connect(output);
    lowpassGain.connect(output);

    output.connect(context.destination);
    output.connect(splitter);

    const left = this.createAnalyzer(context);
    const right = this.createAnalyzer(context);
    const mid = this.createAnalyzer(context);
    const side = this.createAnalyzer(context);

    splitter.connect(left, 0);
    splitter.connect(right, 1);

    const midLeft = context.createGain();
    const midRight = context.createGain();
    const sideLeft = context.createGain();
    const sideRight = context.createGain();
    midLeft.gain.value = MATRIX_GAIN;
    midRight.gain.value = MATRIX_GAIN;
    sideLeft.gain.value = MATRIX_GAIN;
    sideRight.gain.value = -MATRIX_GAIN;

    splitter.connect(midLeft, 0);
    splitter.connect(midRight, 1);
    splitter.connect(sideLeft, 0);
    splitter.connect(sideRight, 1);
    midLeft.connect(mid);
    midRight.connect(mid);
    sideLeft.connect(side);
    sideRight.connect(side);

    left.connect(silentSink);
    right.connect(silentSink);
    mid.connect(silentSink);
    side.connect(silentSink);
    silentSink.connect(context.destination);

    this.context = context;
    this.gainA = gainA;
    this.gainB = gainB;
    this.channelGains = {
      stereo: stereoGain,
      left: leftGain,
      right: rightGain,
      mid: midGain,
      side: sideGain,
    };
    this.filterGains = { off: dryGain, highpass: highpassGain, lowpass: lowpassGain };
    this.highpassNode = highpassNode;
    this.lowpassNode = lowpassNode;
    this.output = output;
    this.splitter = splitter;
    this.silentSink = silentSink;
    this.analyzerBank = { left, right, mid, side };
    this.applyActiveGains(true);
    this.applyAuditionChannel(true);
    this.updateFilterFrequencies();
    this.applyAuditionFilter(true);
    return context;
  }

  private connectStereoMode(
    context: AudioContext,
    splitter: ChannelSplitterNode,
    destination: AudioNode,
  ): GainNode {
    const merger = context.createChannelMerger(2);
    const gain = context.createGain();
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
    merger.connect(gain);
    gain.connect(destination);
    return gain;
  }

  private connectMonoMode(
    context: AudioContext,
    splitter: ChannelSplitterNode,
    sourceChannel: number,
    level: number,
    destination: AudioNode,
  ): GainNode {
    const sourceGain = context.createGain();
    const merger = context.createChannelMerger(2);
    const gain = context.createGain();
    sourceGain.gain.value = level;
    splitter.connect(sourceGain, sourceChannel);
    sourceGain.connect(merger, 0, 0);
    sourceGain.connect(merger, 0, 1);
    merger.connect(gain);
    gain.connect(destination);
    return gain;
  }

  private connectMatrixMode(
    context: AudioContext,
    splitter: ChannelSplitterNode,
    leftLevel: number,
    rightLevel: number,
    destination: AudioNode,
  ): GainNode {
    const left = context.createGain();
    const right = context.createGain();
    const sum = context.createGain();
    const merger = context.createChannelMerger(2);
    const gain = context.createGain();
    left.gain.value = leftLevel;
    right.gain.value = rightLevel;
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(sum);
    right.connect(sum);
    sum.connect(merger, 0, 0);
    sum.connect(merger, 0, 1);
    merger.connect(gain);
    gain.connect(destination);
    return gain;
  }

  private applyActiveGains(immediate: boolean): void {
    if (!this.context || !this.gainA || !this.gainB) return;
    const now = this.context.currentTime;
    this.setGain(this.gainA.gain, this.activeComparisonSlot === 'a' ? 1 : 0, now, immediate);
    this.setGain(this.gainB.gain, this.activeComparisonSlot === 'b' ? 1 : 0, now, immediate);
  }

  private applyAuditionChannel(immediate: boolean): void {
    if (!this.context || !this.channelGains) return;
    const now = this.context.currentTime;
    for (const [channel, gain] of Object.entries(this.channelGains) as [AuditionChannel, GainNode][]) {
      this.setGain(gain.gain, channel === this.auditionChannel ? 1 : 0, now, immediate);
    }
  }

  private applyAuditionFilter(immediate: boolean): void {
    if (!this.context || !this.filterGains) return;
    const now = this.context.currentTime;
    for (const [mode, gain] of Object.entries(this.filterGains) as [AuditionFilterMode, GainNode][]) {
      this.setGain(gain.gain, mode === this.auditionFilter ? 1 : 0, now, immediate);
    }
  }

  private updateFilterFrequencies(): void {
    if (!this.context || !this.highpassNode || !this.lowpassNode) return;
    const maximum = this.context.sampleRate * 0.49;
    this.highpassNode.frequency.value = Math.max(20, Math.min(maximum, this.highpassFrequency));
    this.lowpassNode.frequency.value = Math.max(20, Math.min(maximum, this.lowpassFrequency));
  }

  private setGain(parameter: AudioParam, target: number, now: number, immediate: boolean): void {
    if (immediate) {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(target, now);
      return;
    }

    parameter.cancelAndHoldAtTime(now);
    parameter.linearRampToValueAtTime(target, now + SOURCE_SWITCH_SECONDS);
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

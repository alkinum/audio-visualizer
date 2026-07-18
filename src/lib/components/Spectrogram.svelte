<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { dbToAuditionPaletteIndex, makeAuditionSpectrumPalette } from '$lib/audio/spectrogram-palette';
  import type { AnalysisChannel, OfflineAnalysis, ResolvedTheme, SpectrogramMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    analysis: OfflineAnalysis;
    duration: number;
    currentTime: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
  }

  interface CachedRaster {
    source: Float32Array;
    canvas: HTMLCanvasElement;
  }

  const height = 430;
  const allChannels: AnalysisChannel[] = ['combined', 'left', 'right', 'mid', 'side'];
  const heatPalette = makeAuditionSpectrumPalette();
  const rasterCache = new SvelteMap<AnalysisChannel, CachedRaster>();
  let { analysis, duration, currentTime, theme, onSeek }: Props = $props();
  let mode = $state<SpectrogramMode>('combined');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let seeking = $state(false);
  let cacheSource: Float32Array | null = null;
  let prewarmTimer: number | undefined;
  const playhead = $derived(duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0);

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (prewarmTimer !== undefined) window.clearTimeout(prewarmTimer);
      rasterCache.clear();
    };
  });

  $effect(() => {
    const currentAnalysis = analysis;
    const currentMode = mode;
    const currentTheme = theme;
    const currentWidth = width;
    const nextCacheSource = currentAnalysis.channels.combined;
    if (cacheSource !== nextCacheSource) {
      cacheSource = nextCacheSource;
      rasterCache.clear();
      if (prewarmTimer !== undefined) window.clearTimeout(prewarmTimer);
      prewarmTimer = undefined;
    }
    if (currentAnalysis && currentMode && currentTheme && currentWidth > 0) {
      draw();
      scheduleRasterPrewarm();
    }
  });

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(container);
    const channels: AnalysisChannel[] =
      mode === 'combined' ? ['combined'] : mode === 'lr' ? ['left', 'right'] : ['mid', 'side'];
    const panelHeight = height / channels.length;

    channels.forEach((channel, index) => {
      drawPanel(
        context,
        channel,
        index * panelHeight,
        panelHeight,
        styles.getPropertyValue(`--channel-${channel}`).trim(),
      );
    });
  }

  function drawPanel(
    context: CanvasRenderingContext2D,
    channel: AnalysisChannel,
    top: number,
    panelHeight: number,
    tagColor: string,
  ): void {
    const raster = getSpectrumRaster(channel);
    context.imageSmoothingEnabled = false;
    context.drawImage(raster, 0, top, width, panelHeight);

    drawFrequencyAxis(context, top, panelHeight);
    if (top > 0) {
      context.fillStyle = 'rgb(255 255 255 / 0.34)';
      context.fillRect(0, top, width, 1);
    }
    drawChannelTag(context, channel, top, tagColor);
  }

  function drawFrequencyAxis(context: CanvasRenderingContext2D, top: number, panelHeight: number): void {
    const nyquist = analysis.sampleRate / 2;
    const frequencies = makeFrequencyTicks(nyquist);
    context.save();
    context.lineWidth = 1;
    context.font = '9px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'right';
    context.shadowColor = 'rgb(0 0 0 / 0.82)';
    context.shadowBlur = 3;

    frequencies.forEach((frequency) => {
      const ratio = frequencyToRatio(frequency);
      const rawY = top + panelHeight - ratio * panelHeight;
      const lineY = Math.max(top + 0.5, Math.min(top + panelHeight - 0.5, rawY));
      context.shadowBlur = 0;
      context.strokeStyle = ratio === 0 || ratio === 1 ? 'rgb(255 255 255 / 0.2)' : 'rgb(255 255 255 / 0.1)';
      context.beginPath();
      context.moveTo(0, lineY);
      context.lineTo(width, lineY);
      context.stroke();

      context.shadowBlur = 3;
      context.fillStyle = 'rgb(229 232 241 / 0.68)';
      context.textBaseline = ratio > 0.98 ? 'top' : ratio < 0.02 ? 'bottom' : 'middle';
      const labelY = ratio > 0.98 ? top + 7 : ratio < 0.02 ? top + panelHeight - 7 : rawY;
      context.fillText(formatFrequencyLabel(frequency), width - 8, labelY);
    });
    context.restore();
  }

  function drawChannelTag(
    context: CanvasRenderingContext2D,
    channel: AnalysisChannel,
    top: number,
    tagColor: string,
  ): void {
    const label = channelLabel(channel);
    context.save();
    context.font = '700 9px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const tagWidth = Math.ceil(context.measureText(label).width) + 23;
    const x = 8;
    const y = top + 8;
    context.fillStyle = 'rgb(3 4 12 / 0.86)';
    context.fillRect(x, y, tagWidth, 22);
    context.strokeStyle = tagColor;
    context.strokeRect(x + 0.5, y + 0.5, tagWidth - 1, 21);
    context.fillStyle = tagColor;
    context.fillRect(x, y, 4, 22);
    context.fillStyle = 'rgb(248 249 252 / 0.94)';
    context.fillText(label, x + 13, y + 11);
    context.restore();
  }

  function getSpectrumRaster(channel: AnalysisChannel): HTMLCanvasElement {
    const values = analysis.channels[channel];
    const cached = rasterCache.get(channel);
    if (cached?.source === values) return cached.canvas;

    const raster = makeSpectrumRaster(values);
    rasterCache.set(channel, { source: values, canvas: raster });
    return raster;
  }

  function makeSpectrumRaster(values: Float32Array): HTMLCanvasElement {
    const raster = document.createElement('canvas');
    raster.width = analysis.frameCount;
    raster.height = analysis.binCount;
    const rasterContext = raster.getContext('2d');
    if (!rasterContext) return raster;

    const image = rasterContext.createImageData(analysis.frameCount, analysis.binCount);
    for (let frame = 0; frame < analysis.frameCount; frame += 1) {
      const sourceOffset = frame * analysis.binCount;
      for (let bin = 0; bin < analysis.binCount; bin += 1) {
        const paletteIndex = dbToAuditionPaletteIndex(
          values[sourceOffset + bin],
          analysis.minDb,
          analysis.maxDb,
        );
        const colorOffset = paletteIndex * 4;
        const pixelOffset = ((analysis.binCount - 1 - bin) * analysis.frameCount + frame) * 4;
        image.data[pixelOffset] = heatPalette[colorOffset];
        image.data[pixelOffset + 1] = heatPalette[colorOffset + 1];
        image.data[pixelOffset + 2] = heatPalette[colorOffset + 2];
        image.data[pixelOffset + 3] = 255;
      }
    }
    rasterContext.putImageData(image, 0, 0);
    return raster;
  }

  function scheduleRasterPrewarm(): void {
    if (prewarmTimer !== undefined) return;
    const nextChannel = allChannels.find((channel) => !rasterCache.has(channel));
    if (!nextChannel) return;

    prewarmTimer = window.setTimeout(() => {
      prewarmTimer = undefined;
      getSpectrumRaster(nextChannel);
      scheduleRasterPrewarm();
    }, 24);
  }

  function frequencyToRatio(frequency: number): number {
    return Math.max(0, Math.min(1, frequency / Math.max(1, analysis.sampleRate / 2)));
  }

  function makeFrequencyTicks(nyquist: number): number[] {
    const roughStep = nyquist / 5;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, roughStep)));
    const normalized = roughStep / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = multiplier * magnitude;
    const ticks = [0];
    for (let frequency = step; frequency < nyquist; frequency += step) ticks.push(frequency);
    ticks.push(nyquist);
    return ticks;
  }

  function channelLabel(channel: AnalysisChannel): string {
    return ({
      combined: 'MIX  STEREO',
      left: 'L  LEFT CHANNEL',
      right: 'R  RIGHT CHANNEL',
      mid: 'M  MID CHANNEL',
      side: 'S  SIDE CHANNEL',
    })[channel];
  }

  function formatFrequencyLabel(frequency: number): string {
    if (frequency >= 1000) return `${Number((frequency / 1000).toFixed(1))} kHz`;
    return `${Math.round(frequency)} Hz`;
  }

  function seekAt(event: PointerEvent): void {
    const bounds = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    onSeek(ratio * duration);
  }

  function handlePointerDown(event: PointerEvent): void {
    seeking = true;
    container.setPointerCapture(event.pointerId);
    seekAt(event);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (seeking) seekAt(event);
  }

  function handlePointerUp(event: PointerEvent): void {
    seeking = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.max(0, Math.min(duration, currentTime + (event.key === 'ArrowLeft' ? -5 : 5))));
    }
  }
</script>

<section class="viz-section spectrogram-section" aria-labelledby="spectrogram-title">
  <div class="section-heading">
    <div>
      <h2 id="spectrogram-title">Spectral history</h2>
      <span class="section-value">0 Hz - {Math.round(analysis.sampleRate / 2000)} kHz</span>
    </div>
    <div class="segmented spectrogram-modes" aria-label="Spectrogram channel mode">
      <button class:active={mode === 'combined'} type="button" onclick={() => (mode = 'combined')}>
        <span class="mode-channel-mark mix-mark" aria-hidden="true"><i></i></span>
        Mix
      </button>
      <button class:active={mode === 'lr'} type="button" onclick={() => (mode = 'lr')} title="Left and right channels">
        <span class="mode-channel-mark lr-mark" aria-hidden="true"><i></i><i></i></span>
        L / R
      </button>
      <button class:active={mode === 'ms'} type="button" onclick={() => (mode = 'ms')} title="Mid and side channels">
        <span class="mode-channel-mark ms-mark" aria-hidden="true"><i></i><i></i></span>
        M / S
      </button>
    </div>
  </div>
  <div
    bind:this={container}
    class:seeking
    class="spectrogram-canvas canvas-surface"
    style:height={`${height}px`}
    role="slider"
    aria-label="Spectrogram position"
    aria-valuemin="0"
    aria-valuemax={duration}
    aria-valuenow={currentTime}
    aria-valuetext={formatTime(currentTime, true)}
    tabindex="0"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onkeydown={handleKeydown}
  >
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    <div class="playhead" style:left={`${playhead}%`} aria-hidden="true">
      <span>{formatTime(currentTime, true)}</span>
    </div>
  </div>
</section>

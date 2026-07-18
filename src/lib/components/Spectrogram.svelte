<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowDown, ArrowUp, Maximize2, ZoomIn, ZoomOut } from '@lucide/svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { panAxisRange, zoomAxisRange } from '$lib/audio/chart-viewport';
  import { observeDevicePixelRatio, prepareCanvas } from '$lib/canvas-resolution';
  import { dbToAuditionPaletteIndex, makeAuditionSpectrumPalette } from '$lib/audio/spectrogram-palette';
  import { frequencyToSpectrumRatio, spectrumRatioToFrequency } from '$lib/audio/spectrum-frequency-scale';
  import type { AnalysisChannel, OfflineAnalysis, ResolvedTheme, SpectrogramMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    analysis: OfflineAnalysis;
    duration: number;
    currentTime: number;
    viewStart: number;
    viewEnd: number;
    frequencyMin: number;
    frequencyMax: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
    onTimeViewChange: (start: number, end: number) => void;
    onFrequencyViewChange: (minimum: number, maximum: number) => void;
  }

  interface CachedRaster {
    source: Float32Array;
    canvas: HTMLCanvasElement;
  }

  const height = 430;
  const allChannels: AnalysisChannel[] = ['combined', 'left', 'right', 'mid', 'side'];
  const heatPalette = makeAuditionSpectrumPalette();
  const rasterCache = new SvelteMap<AnalysisChannel, CachedRaster>();
  let {
    analysis,
    duration,
    currentTime,
    viewStart,
    viewEnd,
    frequencyMin,
    frequencyMax,
    theme,
    onSeek,
    onTimeViewChange,
    onFrequencyViewChange,
  }: Props = $props();
  let mode = $state<SpectrogramMode>('combined');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let dpr = $state(1);
  let seeking = $state(false);
  let cacheSource: Float32Array | null = null;
  let prewarmTimer: number | undefined;
  const playheadVisible = $derived(currentTime >= viewStart && currentTime <= viewEnd);
  const playhead = $derived(
    viewEnd > viewStart ? Math.min(100, Math.max(0, ((currentTime - viewStart) / (viewEnd - viewStart)) * 100)) : 0,
  );
  const timeTicks = $derived.by(() =>
    Array.from({ length: 5 }, (_, index) => viewStart + ((viewEnd - viewStart) * index) / 4),
  );
  const timeZoomed = $derived(viewEnd - viewStart < duration - 0.001);
  const frequencyZoomed = $derived(
    frequencyMin > 0.01 || frequencyMax < analysis.sampleRate / 2 - 0.01,
  );
  const canPanFrequencyDown = $derived(frequencyZoomed && frequencyMin > 0.01);
  const canPanFrequencyUp = $derived(
    frequencyZoomed && frequencyMax < analysis.sampleRate / 2 - 0.01,
  );

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
    });
    observer.observe(container);
    const stopDprObserver = observeDevicePixelRatio((ratio) => (dpr = ratio));
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      stopDprObserver();
      container.removeEventListener('wheel', handleWheel);
      if (prewarmTimer !== undefined) window.clearTimeout(prewarmTimer);
      rasterCache.clear();
    };
  });

  $effect(() => {
    const currentAnalysis = analysis;
    const currentMode = mode;
    const currentTheme = theme;
    const currentWidth = width;
    const currentDpr = dpr;
    const currentViewStart = viewStart;
    const currentViewEnd = viewEnd;
    const currentFrequencyMin = frequencyMin;
    const currentFrequencyMax = frequencyMax;
    const nextCacheSource = currentAnalysis.channels.combined;
    if (cacheSource !== nextCacheSource) {
      cacheSource = nextCacheSource;
      rasterCache.clear();
      if (prewarmTimer !== undefined) window.clearTimeout(prewarmTimer);
      prewarmTimer = undefined;
    }
    if (
      currentAnalysis &&
      currentMode &&
      currentTheme &&
      currentWidth > 0 &&
      currentDpr > 0 &&
      currentViewEnd > currentViewStart &&
      currentFrequencyMax > currentFrequencyMin
    ) {
      draw();
      scheduleRasterPrewarm();
    }
  });

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const context = prepareCanvas(canvas, width, height, dpr);
    if (!context) return;
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(container);
    const channels: AnalysisChannel[] =
      mode === 'combined' ? ['combined'] : mode === 'lr' ? ['left', 'right'] : ['mid', 'side'];
    const panelHeight = height / channels.length;

    channels.forEach((channel, index) => {
      drawPanel(context, channel, index * panelHeight, panelHeight);
    });

    drawTimeGrid(context);
    channels.forEach((channel, index) => {
      drawChannelTag(
        context,
        channel,
        index * panelHeight,
        styles.getPropertyValue(`--channel-${channel}`).trim(),
      );
    });
  }

  function drawPanel(
    context: CanvasRenderingContext2D,
    channel: AnalysisChannel,
    top: number,
    panelHeight: number,
  ): void {
    const raster = getSpectrumRaster(channel);
    const minimumRatio = frequencyToRatio(frequencyMin);
    const maximumRatio = frequencyToRatio(frequencyMax);
    const sourceX = Math.max(0, Math.min(raster.width, (viewStart / duration) * raster.width));
    const sourceWidth = Math.max(
      0.5,
      Math.min(raster.width - sourceX, ((viewEnd - viewStart) / duration) * raster.width),
    );
    const sourceY = Math.max(0, (1 - maximumRatio) * raster.height);
    const sourceHeight = Math.max(0.5, (maximumRatio - minimumRatio) * raster.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(raster, sourceX, sourceY, sourceWidth, sourceHeight, 0, top, width, panelHeight);

    drawFrequencyAxis(context, top, panelHeight);
    if (top > 0) {
      context.fillStyle = 'rgb(255 255 255 / 0.34)';
      context.fillRect(0, top, width, 1);
    }
  }

  function drawFrequencyAxis(context: CanvasRenderingContext2D, top: number, panelHeight: number): void {
    const nyquist = analysis.sampleRate / 2;
    const frequencies = frequencyTicks(nyquist);
    context.save();
    context.lineWidth = 1;
    context.font = '9px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'right';
    context.shadowColor = 'rgb(0 0 0 / 0.82)';
    context.shadowBlur = 3;

    frequencies.forEach((frequency) => {
      const ratio = visibleFrequencyRatio(frequency);
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

  function drawTimeGrid(context: CanvasRenderingContext2D): void {
    context.save();
    context.lineWidth = 1;
    timeTicks.forEach((_, index) => {
      const x = Math.round((width * index) / 4) + 0.5;
      context.strokeStyle = index === 0 || index === 4 ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.08)';
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
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
    return frequencyToSpectrumRatio(frequency, analysis.sampleRate / 2);
  }

  function visibleFrequencyRatio(frequency: number): number {
    const minimumRatio = frequencyToRatio(frequencyMin);
    const maximumRatio = frequencyToRatio(frequencyMax);
    return (frequencyToRatio(frequency) - minimumRatio) / Math.max(Number.EPSILON, maximumRatio - minimumRatio);
  }

  function frequencyTicks(nyquist: number): number[] {
    const candidates = [
      0, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 20_000, 30_000, 40_000, 48_000, 96_000,
    ];
    const visible = candidates.filter((frequency) => frequency > frequencyMin && frequency < frequencyMax && frequency <= nyquist);
    return Array.from(new Set([frequencyMin, ...visible, frequencyMax]));
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
    onSeek(viewStart + ratio * (viewEnd - viewStart));
  }

  function zoomTime(factor: number, anchor = (viewStart + viewEnd) / 2): void {
    if (duration <= 0) return;
    const minimumSpan = Math.min(duration, Math.max(0.25, duration / 200));
    const range = zoomAxisRange({ start: viewStart, end: viewEnd }, factor, anchor, 0, duration, minimumSpan);
    onTimeViewChange(range.start, range.end);
  }

  function zoomFrequency(factor: number, anchor = (frequencyMin + frequencyMax) / 2): void {
    const nyquist = analysis.sampleRate / 2;
    const range = zoomAxisRange(
      { start: frequencyMin, end: frequencyMax },
      factor,
      anchor,
      0,
      nyquist,
      Math.min(nyquist, Math.max(500, nyquist / 32)),
    );
    onFrequencyViewChange(range.start, range.end);
  }

  function panFrequency(direction: -1 | 1): void {
    const nyquist = analysis.sampleRate / 2;
    const span = frequencyMax - frequencyMin;
    const range = panAxisRange(
      { start: frequencyMin, end: frequencyMax },
      direction * span * 0.25,
      0,
      nyquist,
      Math.min(nyquist, Math.max(500, nyquist / 32)),
    );
    onFrequencyViewChange(range.start, range.end);
  }

  function resetView(): void {
    onTimeViewChange(0, duration);
    onFrequencyViewChange(0, analysis.sampleRate / 2);
  }

  function handleWheel(event: WheelEvent): void {
    if (duration <= 0) return;
    event.preventDefault();
    const delta = event.deltaY || event.deltaX;
    const factor = Math.exp(Math.max(-240, Math.min(240, delta)) * 0.0018);
    const bounds = container.getBoundingClientRect();

    if (event.shiftKey) {
      const channelCount = mode === 'combined' ? 1 : 2;
      const panelHeight = bounds.height / channelCount;
      const localY = ((event.clientY - bounds.top) % panelHeight + panelHeight) % panelHeight;
      const visibleRatio = 1 - Math.max(0, Math.min(1, localY / panelHeight));
      const minimumRatio = frequencyToRatio(frequencyMin);
      const maximumRatio = frequencyToRatio(frequencyMax);
      const anchor = spectrumRatioToFrequency(
        minimumRatio + visibleRatio * (maximumRatio - minimumRatio),
        analysis.sampleRate / 2,
      );
      zoomFrequency(factor, anchor);
    } else {
      const pointerRatio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      zoomTime(factor, viewStart + pointerRatio * (viewEnd - viewStart));
    }
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
      <span class="section-value">
        {formatFrequencyLabel(frequencyMin)} - {formatFrequencyLabel(frequencyMax)}
      </span>
    </div>
    <div class="spectrogram-heading-tools">
      <div class="axis-tools" aria-label="Chart zoom controls">
        <span>X</span>
        <button type="button" onclick={() => zoomTime(0.65)} aria-label="Zoom in time" title="Zoom in time">
          <ZoomIn size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onclick={() => zoomTime(1.55)}
          aria-label="Zoom out time"
          title="Zoom out time"
          disabled={!timeZoomed}
        >
          <ZoomOut size={14} strokeWidth={1.8} />
        </button>
        <i></i>
        <span>Y</span>
        <button type="button" onclick={() => zoomFrequency(0.65)} aria-label="Zoom in frequency" title="Zoom in frequency">
          <ZoomIn size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onclick={() => zoomFrequency(1.55)}
          aria-label="Zoom out frequency"
          title="Zoom out frequency"
          disabled={!frequencyZoomed}
        >
          <ZoomOut size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onclick={() => panFrequency(-1)}
          aria-label="Pan frequency range down"
          title="Pan frequency range down"
          disabled={!canPanFrequencyDown}
        >
          <ArrowDown size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onclick={() => panFrequency(1)}
          aria-label="Pan frequency range up"
          title="Pan frequency range up"
          disabled={!canPanFrequencyUp}
        >
          <ArrowUp size={14} strokeWidth={1.8} />
        </button>
        <i></i>
        <button
          type="button"
          onclick={resetView}
          aria-label="Fit full time and frequency range"
          title="Fit full range"
          disabled={!timeZoomed && !frequencyZoomed}
        >
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
      </div>
      <div class="segmented spectrogram-modes" aria-label="Spectrogram channel mode">
        <button
          class:active={mode === 'combined'}
          type="button"
          aria-pressed={mode === 'combined'}
          onclick={() => (mode = 'combined')}
        >
          <span class="mode-channel-mark mix-mark" aria-hidden="true"><i></i></span>
          Mix
        </button>
        <button
          class:active={mode === 'lr'}
          type="button"
          aria-pressed={mode === 'lr'}
          onclick={() => (mode = 'lr')}
          title="Left and right channels"
        >
          <span class="mode-channel-mark lr-mark" aria-hidden="true"><i></i><i></i></span>
          L / R
        </button>
        <button
          class:active={mode === 'ms'}
          type="button"
          aria-pressed={mode === 'ms'}
          onclick={() => (mode = 'ms')}
          title="Mid and side channels"
        >
          <span class="mode-channel-mark ms-mark" aria-hidden="true"><i></i><i></i></span>
          M / S
        </button>
      </div>
    </div>
  </div>
  <div class="spectrogram-time-ruler" aria-hidden="true">
    {#each timeTicks as tick, index (tick)}
      <span style:left={`${index * 25}%`}>{formatTime(tick, true)}</span>
    {/each}
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
    {#if playheadVisible}
      <div class="playhead" style:left={`${playhead}%`} aria-hidden="true">
        <span>{formatTime(currentTime, true)}</span>
      </div>
    {/if}
  </div>
</section>

<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowDown, ArrowUp, Maximize2, ZoomIn, ZoomOut } from '@lucide/svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { panAxisRange, zoomAxisRange } from '$lib/audio/chart-viewport';
  import { observeDevicePixelRatio, prepareCanvas } from '$lib/canvas-resolution';
  import { dbToAuditionPaletteIndex, makeAuditionSpectrumPalette } from '$lib/audio/spectrogram-palette';
  import {
    layoutSpectrumFrequencyTicks,
    SPECTRUM_FREQUENCY_LABEL_HEIGHT,
  } from '$lib/audio/spectrum-frequency-axis';
  import { frequencyToSpectrumRatio, spectrumRatioToFrequency } from '$lib/audio/spectrum-frequency-scale';
  import type {
    AnalysisChannel,
    AnalysisProgress,
    OfflineAnalysis,
    ResolvedTheme,
    SpectrogramMode,
  } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    analysis: OfflineAnalysis;
    comparisonAnalysis?: OfflineAnalysis | null;
    comparisonDuration?: number;
    comparisonPending?: boolean;
    comparisonProgress?: AnalysisProgress | null;
    comparisonError?: string;
    duration: number;
    currentTime: number;
    viewStart: number;
    viewEnd: number;
    frequencyMin: number;
    frequencyMax: number;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
    onTimeViewChange: (start: number, end: number) => void;
    onFrequencyViewChange: (minimum: number, maximum: number) => void;
  }

  interface CachedRaster {
    source: Float32Array;
    canvas: HTMLCanvasElement;
  }

  interface SourcePanel {
    key: 'a' | 'b';
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
    sourceDuration: number;
    analysis: OfflineAnalysis | null;
  }

  type PointerAction = 'pending' | 'pan-time' | 'pan-frequency';

  const panelGap = 8;
  const rulerHeight = 25;
  const allChannels: AnalysisChannel[] = ['combined', 'left', 'right', 'mid', 'side'];
  const heatPalette = makeAuditionSpectrumPalette();
  const rasterCache = new SvelteMap<string, CachedRaster>();

  let {
    analysis,
    comparisonAnalysis = null,
    comparisonDuration = 0,
    comparisonPending = false,
    comparisonProgress = null,
    comparisonError = '',
    duration,
    currentTime,
    viewStart,
    viewEnd,
    frequencyMin,
    frequencyMax,
    loopEnabled,
    loopStart,
    loopEnd,
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
  let pointerAction = $state<PointerAction | null>(null);
  let pointerStartX = 0;
  let pointerStartY = 0;
  let initialViewStart = 0;
  let initialViewEnd = 0;
  let initialFrequencyMin = 0;
  let initialFrequencyMax = 0;
  let moved = false;
  let prewarmTimer: number | undefined;
  let cacheSourceA: Float32Array | null = null;
  let cacheSourceB: Float32Array | null = null;

  const hasComparison = $derived(comparisonDuration > 0);
  const stacked = $derived(hasComparison && width < 720);
  const canvasHeight = $derived(hasComparison && stacked ? 720 : 430);
  const channels = $derived.by((): AnalysisChannel[] =>
    mode === 'combined' ? ['combined'] : mode === 'lr' ? ['left', 'right'] : ['mid', 'side'],
  );
  const sourcePanels = $derived.by(makeSourcePanels);
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
    const redraw = {
      analysis,
      comparisonAnalysis,
      comparisonDuration,
      comparisonPending,
      comparisonProgress,
      comparisonError,
      mode,
      theme,
      width,
      dpr,
      viewStart,
      viewEnd,
      frequencyMin,
      frequencyMax,
      canvasHeight,
    };
    const nextSourceA = redraw.analysis.channels.combined;
    const nextSourceB = redraw.comparisonAnalysis?.channels.combined ?? null;
    if (cacheSourceA !== nextSourceA || cacheSourceB !== nextSourceB) {
      cacheSourceA = nextSourceA;
      cacheSourceB = nextSourceB;
      rasterCache.clear();
      if (prewarmTimer !== undefined) window.clearTimeout(prewarmTimer);
      prewarmTimer = undefined;
    }
    if (
      redraw.width > 0 &&
      redraw.dpr > 0 &&
      redraw.viewEnd > redraw.viewStart &&
      redraw.frequencyMax > redraw.frequencyMin
    ) {
      draw();
      scheduleRasterPrewarm();
    }
  });

  function makeSourcePanels(): SourcePanel[] {
    if (width <= 0) return [];
    if (!hasComparison) {
      return [{ key: 'a', label: 'A', left: 0, top: 0, width, height: canvasHeight, sourceDuration: duration, analysis }];
    }
    if (stacked) {
      const panelHeight = (canvasHeight - panelGap) / 2;
      return [
        { key: 'a', label: 'A', left: 0, top: 0, width, height: panelHeight, sourceDuration: duration, analysis },
        {
          key: 'b',
          label: 'B',
          left: 0,
          top: panelHeight + panelGap,
          width,
          height: panelHeight,
          sourceDuration: comparisonDuration,
          analysis: comparisonAnalysis,
        },
      ];
    }
    const panelWidth = (width - panelGap) / 2;
    return [
      { key: 'a', label: 'A', left: 0, top: 0, width: panelWidth, height: canvasHeight, sourceDuration: duration, analysis },
      {
        key: 'b',
        label: 'B',
        left: panelWidth + panelGap,
        top: 0,
        width: panelWidth,
        height: canvasHeight,
        sourceDuration: comparisonDuration,
        analysis: comparisonAnalysis,
      },
    ];
  }

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const context = prepareCanvas(canvas, width, canvasHeight, dpr);
    if (!context) return;
    context.clearRect(0, 0, width, canvasHeight);
    const styles = getComputedStyle(container);
    const surface = styles.getPropertyValue('--surface-muted').trim();

    for (const source of sourcePanels) {
      context.save();
      context.beginPath();
      context.rect(source.left, source.top, source.width, source.height);
      context.clip();
      context.fillStyle = surface;
      context.fillRect(source.left, source.top, source.width, source.height);
      drawTimeRuler(context, source);

      const chartTop = source.top + rulerHeight;
      const chartHeight = source.height - rulerHeight;
      if (source.analysis) {
        const channelHeight = chartHeight / channels.length;
        channels.forEach((channel, index) => {
          const top = chartTop + index * channelHeight;
          drawChannel(context, source, channel, top, channelHeight);
          drawChannelTag(
            context,
            source,
            channel,
            top,
            styles.getPropertyValue(`--channel-${channel}`).trim(),
          );
        });
      } else {
        drawUnavailableState(context, source, chartTop, chartHeight);
      }
      context.restore();
    }
  }

  function drawTimeRuler(context: CanvasRenderingContext2D, source: SourcePanel): void {
    const ticks = Array.from({ length: 5 }, (_, index) => viewStart + ((viewEnd - viewStart) * index) / 4);
    context.save();
    context.fillStyle = 'rgb(5 7 13 / 0.28)';
    context.fillRect(source.left, source.top, source.width, rulerHeight);
    context.font = '8px SFMono-Regular, Consolas, monospace';
    context.fillStyle = 'rgb(229 232 241 / 0.68)';
    context.textBaseline = 'middle';

    ticks.forEach((tick, index) => {
      const x = source.left + (source.width * index) / 4;
      context.strokeStyle = index === 0 || index === 4 ? 'rgb(255 255 255 / 0.18)' : 'rgb(255 255 255 / 0.08)';
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, source.top);
      context.lineTo(Math.round(x) + 0.5, source.top + source.height);
      context.stroke();
      context.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
      const labelX = index === 0 ? x + 36 : index === 4 ? x - 7 : x;
      context.fillText(formatTime(tick, true), labelX, source.top + rulerHeight / 2);
    });

    context.fillStyle = source.key === 'a' ? 'rgb(69 205 176 / 0.94)' : 'rgb(213 155 77 / 0.94)';
    context.fillRect(source.left + 7, source.top + 5, 22, 15);
    context.fillStyle = 'rgb(3 5 10 / 0.92)';
    context.font = '700 9px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText(source.label, source.left + 18, source.top + 12.5);
    context.restore();
  }

  function drawChannel(
    context: CanvasRenderingContext2D,
    source: SourcePanel,
    channel: AnalysisChannel,
    top: number,
    channelHeight: number,
  ): void {
    const sourceAnalysis = source.analysis!;
    const intersectionStart = Math.max(0, viewStart);
    const intersectionEnd = Math.min(viewEnd, source.sourceDuration);
    const sourceFrequencyMin = Math.max(0, Math.min(sourceAnalysis.sampleRate / 2, frequencyMin));
    const sourceFrequencyMax = Math.max(0, Math.min(sourceAnalysis.sampleRate / 2, frequencyMax));
    if (intersectionEnd <= intersectionStart || sourceFrequencyMax <= sourceFrequencyMin) {
      drawFrequencyAxis(context, source, top, channelHeight);
      return;
    }

    const raster = getSpectrumRaster(source.key, sourceAnalysis, channel);
    const sourceX = (intersectionStart / source.sourceDuration) * raster.width;
    const sourceWidth = Math.max(0.5, ((intersectionEnd - intersectionStart) / source.sourceDuration) * raster.width);
    const minimumRatio = frequencyToSpectrumRatio(sourceFrequencyMin, sourceAnalysis.sampleRate / 2);
    const maximumRatio = frequencyToSpectrumRatio(sourceFrequencyMax, sourceAnalysis.sampleRate / 2);
    const sourceY = Math.max(0, (1 - maximumRatio) * raster.height);
    const sourceHeight = Math.max(0.5, (maximumRatio - minimumRatio) * raster.height);
    const destinationX = source.left + ((intersectionStart - viewStart) / (viewEnd - viewStart)) * source.width;
    const destinationWidth = ((intersectionEnd - intersectionStart) / (viewEnd - viewStart)) * source.width;
    const destinationTop = top + (1 - visibleFrequencyRatio(sourceFrequencyMax)) * channelHeight;
    const destinationBottom = top + (1 - visibleFrequencyRatio(sourceFrequencyMin)) * channelHeight;

    context.imageSmoothingEnabled = false;
    context.drawImage(
      raster,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      destinationX,
      destinationTop,
      destinationWidth,
      Math.max(0.5, destinationBottom - destinationTop),
    );
    drawFrequencyAxis(context, source, top, channelHeight);
    if (top > source.top + rulerHeight) {
      context.fillStyle = 'rgb(255 255 255 / 0.26)';
      context.fillRect(source.left, top, source.width, 1);
    }
  }

  function drawFrequencyAxis(
    context: CanvasRenderingContext2D,
    source: SourcePanel,
    top: number,
    panelHeight: number,
  ): void {
    context.save();
    context.lineWidth = 1;
    context.font = `${SPECTRUM_FREQUENCY_LABEL_HEIGHT}px SFMono-Regular, Consolas, monospace`;
    context.textAlign = 'right';
    context.shadowColor = 'rgb(0 0 0 / 0.82)';
    context.shadowBlur = 3;

    const ticks = layoutSpectrumFrequencyTicks(frequencyTicks(), visibleFrequencyRatio, top, panelHeight);
    ticks.forEach((tick) => {
      context.shadowBlur = 0;
      context.strokeStyle = tick.ratio === 0 || tick.ratio === 1 ? 'rgb(255 255 255 / 0.2)' : 'rgb(255 255 255 / 0.1)';
      context.beginPath();
      context.moveTo(source.left, tick.lineY);
      context.lineTo(source.left + source.width, tick.lineY);
      context.stroke();

      if (!tick.showLabel) return;
      context.shadowBlur = 3;
      context.fillStyle = 'rgb(229 232 241 / 0.68)';
      context.textBaseline = tick.labelBaseline;
      context.fillText(formatFrequencyLabel(tick.frequency), source.left + source.width - 8, tick.labelY);
    });
    context.restore();
  }

  function drawChannelTag(
    context: CanvasRenderingContext2D,
    source: SourcePanel,
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
    const x = source.left + 8;
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

  function drawUnavailableState(
    context: CanvasRenderingContext2D,
    source: SourcePanel,
    top: number,
    regionHeight: number,
  ): void {
    const message = comparisonPending
      ? `Analyzing B spectrum${comparisonProgress ? `  ${comparisonProgress.progress}%` : ''}`
      : comparisonError || 'B spectrum unavailable';
    context.save();
    context.fillStyle = 'rgb(7 9 15 / 0.48)';
    context.fillRect(source.left, top, source.width, regionHeight);
    context.fillStyle = 'rgb(229 232 241 / 0.62)';
    context.font = '11px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, source.left + source.width / 2, top + regionHeight / 2);
    context.restore();
  }

  function getSpectrumRaster(
    sourceKey: 'a' | 'b',
    sourceAnalysis: OfflineAnalysis,
    channel: AnalysisChannel,
  ): HTMLCanvasElement {
    const values = sourceAnalysis.channels[channel];
    const key = `${sourceKey}:${channel}`;
    const cached = rasterCache.get(key);
    if (cached?.source === values) return cached.canvas;
    const raster = makeSpectrumRaster(sourceAnalysis, values);
    rasterCache.set(key, { source: values, canvas: raster });
    return raster;
  }

  function makeSpectrumRaster(sourceAnalysis: OfflineAnalysis, values: Float32Array): HTMLCanvasElement {
    const raster = document.createElement('canvas');
    raster.width = sourceAnalysis.frameCount;
    raster.height = sourceAnalysis.binCount;
    const rasterContext = raster.getContext('2d');
    if (!rasterContext) return raster;

    const image = rasterContext.createImageData(sourceAnalysis.frameCount, sourceAnalysis.binCount);
    for (let frame = 0; frame < sourceAnalysis.frameCount; frame += 1) {
      const sourceOffset = frame * sourceAnalysis.binCount;
      for (let bin = 0; bin < sourceAnalysis.binCount; bin += 1) {
        const paletteIndex = dbToAuditionPaletteIndex(
          values[sourceOffset + bin],
          sourceAnalysis.minDb,
          sourceAnalysis.maxDb,
        );
        const colorOffset = paletteIndex * 4;
        const pixelOffset = ((sourceAnalysis.binCount - 1 - bin) * sourceAnalysis.frameCount + frame) * 4;
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
    const sources = sourcePanels.filter((source): source is SourcePanel & { analysis: OfflineAnalysis } => Boolean(source.analysis));
    const next = sources
      .flatMap((source) => allChannels.map((channel) => ({ source, channel })))
      .find(({ source, channel }) => !rasterCache.has(`${source.key}:${channel}`));
    if (!next) return;

    prewarmTimer = window.setTimeout(() => {
      prewarmTimer = undefined;
      getSpectrumRaster(next.source.key, next.source.analysis, next.channel);
      scheduleRasterPrewarm();
    }, 24);
  }

  function sharedFrequencyRatio(frequency: number): number {
    return frequencyToSpectrumRatio(frequency, analysis.sampleRate / 2);
  }

  function visibleFrequencyRatio(frequency: number): number {
    const minimumRatio = sharedFrequencyRatio(frequencyMin);
    const maximumRatio = sharedFrequencyRatio(frequencyMax);
    return (sharedFrequencyRatio(frequency) - minimumRatio) / Math.max(Number.EPSILON, maximumRatio - minimumRatio);
  }

  function frequencyTicks(): number[] {
    const candidates = [
      0, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 20_000, 30_000, 40_000, 48_000, 96_000,
    ];
    const nyquist = analysis.sampleRate / 2;
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

  function sourcePanelAt(clientX: number, clientY: number): SourcePanel {
    const bounds = container.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    return sourcePanels.find((panel) =>
      x >= panel.left && x <= panel.left + panel.width && y >= panel.top && y <= panel.top + panel.height
    ) ?? sourcePanels[0];
  }

  function timeAt(clientX: number, clientY: number): number {
    const bounds = container.getBoundingClientRect();
    const panel = sourcePanelAt(clientX, clientY);
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - panel.left) / panel.width));
    return viewStart + ratio * (viewEnd - viewStart);
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
    const bounds = container.getBoundingClientRect();
    const panel = sourcePanelAt(event.clientX, event.clientY);
    const pointerRatio = Math.max(0, Math.min(1, (event.clientX - bounds.left - panel.left) / panel.width));

    if (event.shiftKey) {
      event.preventDefault();
      const chartTop = bounds.top + panel.top + rulerHeight;
      const channelHeight = (panel.height - rulerHeight) / channels.length;
      const localY = ((event.clientY - chartTop) % channelHeight + channelHeight) % channelHeight;
      const visibleRatio = 1 - Math.max(0, Math.min(1, localY / channelHeight));
      const minimumRatio = sharedFrequencyRatio(frequencyMin);
      const maximumRatio = sharedFrequencyRatio(frequencyMax);
      const anchor = spectrumRatioToFrequency(
        minimumRatio + visibleRatio * (maximumRatio - minimumRatio),
        analysis.sampleRate / 2,
      );
      const delta = event.deltaY || event.deltaX;
      zoomFrequency(Math.exp(Math.max(-240, Math.min(240, delta)) * 0.0018), anchor);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomTime(
        Math.exp(Math.max(-240, Math.min(240, event.deltaY)) * 0.0018),
        viewStart + pointerRatio * (viewEnd - viewStart),
      );
      return;
    }

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.55) {
      event.preventDefault();
      const span = viewEnd - viewStart;
      const range = panAxisRange(
        { start: viewStart, end: viewEnd },
        (event.deltaX / panel.width) * span,
        0,
        duration,
        minimumTimeSpan(),
      );
      onTimeViewChange(range.start, range.end);
      return;
    }

    if (Math.abs(event.deltaY) > 0) {
      event.preventDefault();
      zoomTime(
        Math.exp(Math.max(-240, Math.min(240, event.deltaY)) * 0.0018),
        viewStart + pointerRatio * (viewEnd - viewStart),
      );
    }
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerAction = 'pending';
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    initialViewStart = viewStart;
    initialViewEnd = viewEnd;
    initialFrequencyMin = frequencyMin;
    initialFrequencyMax = frequencyMax;
    moved = false;
    container.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!pointerAction) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    if (!moved && Math.hypot(deltaX, deltaY) >= 5) {
      if (event.pointerType === 'touch' && Math.abs(deltaY) > Math.abs(deltaX)) {
        cancelPointer(event);
        return;
      }
      moved = true;
      pointerAction = event.shiftKey ? 'pan-frequency' : 'pan-time';
    }
    if (!moved) return;
    event.preventDefault();

    const panel = sourcePanelAt(pointerStartX, pointerStartY);
    if (pointerAction === 'pan-time') {
      const span = initialViewEnd - initialViewStart;
      const range = panAxisRange(
        { start: initialViewStart, end: initialViewEnd },
        -(deltaX / panel.width) * span,
        0,
        duration,
        minimumTimeSpan(),
      );
      onTimeViewChange(range.start, range.end);
    } else if (pointerAction === 'pan-frequency') {
      const span = initialFrequencyMax - initialFrequencyMin;
      const range = panAxisRange(
        { start: initialFrequencyMin, end: initialFrequencyMax },
        (deltaY / Math.max(1, panel.height - rulerHeight)) * span,
        0,
        analysis.sampleRate / 2,
        Math.min(analysis.sampleRate / 2, Math.max(500, analysis.sampleRate / 64)),
      );
      onFrequencyViewChange(range.start, range.end);
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (pointerAction === 'pending' && !moved) onSeek(timeAt(event.clientX, event.clientY));
    cancelPointer(event);
  }

  function cancelPointer(event: PointerEvent): void {
    pointerAction = null;
    moved = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.max(0, Math.min(duration, currentTime + (event.key === 'ArrowLeft' ? -5 : 5))));
    }
  }

  function minimumTimeSpan(): number {
    return Math.min(duration, Math.max(0.25, duration / 200));
  }

  function overlayLeft(time: number): number {
    return Math.max(0, Math.min(100, ((time - viewStart) / Math.max(Number.EPSILON, viewEnd - viewStart)) * 100));
  }

  function loopOverlayWidth(): number {
    const clippedStart = Math.max(viewStart, loopStart);
    const clippedEnd = Math.min(viewEnd, loopEnd);
    return clippedEnd > clippedStart
      ? ((clippedEnd - clippedStart) / Math.max(Number.EPSILON, viewEnd - viewStart)) * 100
      : 0;
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
        <button type="button" onclick={() => zoomTime(1.55)} aria-label="Zoom out time" title="Zoom out time" disabled={!timeZoomed}>
          <ZoomOut size={14} strokeWidth={1.8} />
        </button>
        <i></i>
        <span>Y</span>
        <button type="button" onclick={() => zoomFrequency(0.65)} aria-label="Zoom in frequency" title="Zoom in frequency">
          <ZoomIn size={14} strokeWidth={1.8} />
        </button>
        <button type="button" onclick={() => zoomFrequency(1.55)} aria-label="Zoom out frequency" title="Zoom out frequency" disabled={!frequencyZoomed}>
          <ZoomOut size={14} strokeWidth={1.8} />
        </button>
        <button type="button" onclick={() => panFrequency(-1)} aria-label="Pan frequency range down" title="Pan frequency range down" disabled={!canPanFrequencyDown}>
          <ArrowDown size={14} strokeWidth={1.8} />
        </button>
        <button type="button" onclick={() => panFrequency(1)} aria-label="Pan frequency range up" title="Pan frequency range up" disabled={!canPanFrequencyUp}>
          <ArrowUp size={14} strokeWidth={1.8} />
        </button>
        <i></i>
        <button type="button" onclick={resetView} aria-label="Fit full time and frequency range" title="Fit full range" disabled={!timeZoomed && !frequencyZoomed}>
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
      </div>
      <div class="segmented spectrogram-modes" aria-label="Spectrogram channel mode">
        <button class:active={mode === 'combined'} type="button" aria-pressed={mode === 'combined'} onclick={() => (mode = 'combined')}>
          <span class="mode-channel-mark mix-mark" aria-hidden="true"><i></i></span>
          Mix
        </button>
        <button class:active={mode === 'lr'} type="button" aria-pressed={mode === 'lr'} onclick={() => (mode = 'lr')} title="Left and right channels">
          <span class="mode-channel-mark lr-mark" aria-hidden="true"><i></i><i></i></span>
          L / R
        </button>
        <button class:active={mode === 'ms'} type="button" aria-pressed={mode === 'ms'} onclick={() => (mode = 'ms')} title="Mid and side channels">
          <span class="mode-channel-mark ms-mark" aria-hidden="true"><i></i><i></i></span>
          M / S
        </button>
      </div>
    </div>
  </div>
  <div
    bind:this={container}
    class:dragging={pointerAction === 'pan-time' || pointerAction === 'pan-frequency'}
    class="spectrogram-canvas canvas-surface"
    style:height={`${canvasHeight + 2}px`}
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
    onpointercancel={cancelPointer}
    onkeydown={handleKeydown}
  >
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#each sourcePanels as source (source.key)}
      <div
        class="spectrogram-panel-overlay"
        style:left={`${source.left}px`}
        style:top={`${source.top + rulerHeight}px`}
        style:width={`${source.width}px`}
        style:height={`${source.height - rulerHeight}px`}
        aria-hidden="true"
      >
        {#if loopEnabled && loopOverlayWidth() > 0}
          <div class="spectrogram-loop" style:left={`${overlayLeft(Math.max(viewStart, loopStart))}%`} style:width={`${loopOverlayWidth()}%`}></div>
        {/if}
        {#if currentTime >= viewStart && currentTime <= viewEnd}
          <div class="playhead" style:left={`${overlayLeft(currentTime)}%`}></div>
        {/if}
      </div>
    {/each}
  </div>
</section>

<script lang="ts">
  import { onMount } from 'svelte';
  import { clampAxisRange, panAxisRange } from '$lib/audio/chart-viewport';
  import { observeDevicePixelRatio, prepareCanvas } from '$lib/canvas-resolution';
  import type { PeakSeries, ResolvedTheme, WaveformData, WaveformMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    data: WaveformData;
    duration: number;
    currentTime: number;
    viewStart: number;
    viewEnd: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
    onViewChange: (start: number, end: number) => void;
  }

  type RangeInteraction = 'pan' | 'start' | 'end';

  let { data, duration, currentTime, viewStart, viewEnd, theme, onSeek, onViewChange }: Props = $props();
  let mode = $state<WaveformMode>('combined');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let dpr = $state(1);
  let seeking = $state(false);
  let rangeInteraction = $state<RangeInteraction | null>(null);
  let rangePointerX = 0;
  let rangeInitialStart = 0;
  let rangeInitialEnd = 0;
  const height = 176;
  const playhead = $derived(duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0);
  const rangeLeft = $derived(duration > 0 ? Math.min(100, Math.max(0, (viewStart / duration) * 100)) : 0);
  const rangeWidth = $derived(
    duration > 0 ? Math.min(100 - rangeLeft, Math.max(0, ((viewEnd - viewStart) / duration) * 100)) : 100,
  );

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
    });
    observer.observe(container);
    const stopDprObserver = observeDevicePixelRatio((ratio) => (dpr = ratio));
    return () => {
      observer.disconnect();
      stopDprObserver();
    };
  });

  $effect(() => {
    const currentData = data;
    const currentMode = mode;
    const currentTheme = theme;
    const currentWidth = width;
    const currentDpr = dpr;
    if (currentData && currentMode && currentTheme && currentWidth >= 0 && currentDpr > 0) draw();
  });

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const context = prepareCanvas(canvas, width, height, dpr);
    if (!context) return;

    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(container);
    const grid = styles.getPropertyValue('--chart-grid').trim();
    const primary = styles.getPropertyValue('--chart-primary').trim();
    const secondary = styles.getPropertyValue('--chart-secondary').trim();
    const label = styles.getPropertyValue('--text-faint').trim();

    if (mode === 'split') {
      drawAmplitudeAxis(context, 0, height / 2, grid, label);
      drawAmplitudeAxis(context, height / 2, height / 2, grid, label);
      drawSeries(context, data.left, 0, height / 2, primary);
      drawSeries(context, data.right, height / 2, height / 2, secondary);
    } else {
      drawAmplitudeAxis(context, 0, height, grid, label);
      drawSeries(context, data.combined, 0, height, primary);
    }
  }

  function drawAmplitudeAxis(
    context: CanvasRenderingContext2D,
    top: number,
    regionHeight: number,
    gridColor: string,
    labelColor: string,
  ): void {
    const center = top + regionHeight / 2;
    const amplitude = regionHeight * 0.42;
    const decibels = regionHeight < 120 ? [0, -6, -12] : [0, -6, -12, -24];
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = gridColor;
    context.fillStyle = labelColor;
    context.font = '8px SFMono-Regular, Consolas, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'middle';

    decibels.forEach((db) => {
      const linear = Math.pow(10, db / 20);
      for (const direction of [-1, 1]) {
        const y = Math.round(center + direction * linear * amplitude) + 0.5;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      const labelY = center - linear * amplitude;
      context.fillText(db === 0 ? '0 dBFS' : `${db}`, width - 6, labelY);
    });

    context.beginPath();
    context.moveTo(0, Math.round(center) + 0.5);
    context.lineTo(width, Math.round(center) + 0.5);
    context.stroke();
    context.restore();
  }

  function drawSeries(
    context: CanvasRenderingContext2D,
    series: PeakSeries,
    top: number,
    regionHeight: number,
    color: string,
  ): void {
    const center = top + regionHeight / 2;
    const amplitude = regionHeight * 0.42;
    context.strokeStyle = color;
    context.globalAlpha = 0.9;
    context.beginPath();

    for (let x = 0; x < width; x += 1) {
      const index = Math.min(series.min.length - 1, Math.floor((x / Math.max(1, width - 1)) * series.min.length));
      const y1 = center - series.max[index] * amplitude;
      const y2 = center - series.min[index] * amplitude;
      context.moveTo(x + 0.5, y1);
      context.lineTo(x + 0.5, y2);
    }

    context.stroke();
    context.globalAlpha = 1;
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
    if (rangeInteraction) {
      updateRangeInteraction(event);
      return;
    }
    if (seeking) seekAt(event);
  }

  function handlePointerUp(event: PointerEvent): void {
    seeking = false;
    rangeInteraction = null;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  }

  function handleRangePointerDown(event: PointerEvent, interaction: RangeInteraction): void {
    event.preventDefault();
    event.stopPropagation();
    rangeInteraction = interaction;
    rangePointerX = event.clientX;
    rangeInitialStart = viewStart;
    rangeInitialEnd = viewEnd;
    container.setPointerCapture(event.pointerId);
  }

  function updateRangeInteraction(event: PointerEvent): void {
    if (!rangeInteraction || width <= 0 || duration <= 0) return;
    const delta = ((event.clientX - rangePointerX) / width) * duration;
    const minimumSpan = minimumViewSpan();

    if (rangeInteraction === 'pan') {
      const range = panAxisRange(
        { start: rangeInitialStart, end: rangeInitialEnd },
        delta,
        0,
        duration,
        minimumSpan,
      );
      onViewChange(range.start, range.end);
      return;
    }

    const range = rangeInteraction === 'start'
      ? clampAxisRange(
          { start: Math.min(rangeInitialEnd - minimumSpan, rangeInitialStart + delta), end: rangeInitialEnd },
          0,
          duration,
          minimumSpan,
        )
      : clampAxisRange(
          { start: rangeInitialStart, end: Math.max(rangeInitialStart + minimumSpan, rangeInitialEnd + delta) },
          0,
          duration,
          minimumSpan,
        );
    onViewChange(range.start, range.end);
  }

  function minimumViewSpan(): number {
    return Math.min(duration, Math.max(0.25, duration / 200));
  }

  function handleRangeKeydown(event: KeyboardEvent, interaction: RangeInteraction): void {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || duration <= 0) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const step = Math.max(minimumViewSpan(), (viewEnd - viewStart) * 0.05) * direction;

    if (interaction === 'pan') {
      const range = panAxisRange({ start: viewStart, end: viewEnd }, step, 0, duration, minimumViewSpan());
      onViewChange(range.start, range.end);
    } else if (interaction === 'start') {
      onViewChange(Math.max(0, Math.min(viewEnd - minimumViewSpan(), viewStart + step)), viewEnd);
    } else {
      onViewChange(viewStart, Math.min(duration, Math.max(viewStart + minimumViewSpan(), viewEnd + step)));
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      onSeek(Math.max(0, Math.min(duration, currentTime + direction * 5)));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onSeek(event.key === 'Home' ? 0 : duration);
    }
  }
</script>

<section class="viz-section" aria-labelledby="waveform-title">
  <div class="section-heading">
    <div>
      <h2 id="waveform-title">Waveform</h2>
      <span class="section-value">
        A overview · {formatTime(viewStart, true)} - {formatTime(viewEnd, true)}
      </span>
    </div>
    <div class="segmented" aria-label="Waveform channel mode">
      <button
        class:active={mode === 'combined'}
        type="button"
        aria-pressed={mode === 'combined'}
        onclick={() => (mode = 'combined')}
      >Mix</button>
      <button
        class:active={mode === 'split'}
        type="button"
        aria-pressed={mode === 'split'}
        onclick={() => (mode = 'split')}
      >L / R</button>
    </div>
  </div>
  <div
    bind:this={container}
    class:seeking
    class="waveform-canvas canvas-surface"
    role="slider"
    aria-label="Audio position"
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
    <div
      class="waveform-window"
      style:left={`${rangeLeft}%`}
      style:width={`${rangeWidth}%`}
    >
      <div
        class="waveform-range-grip"
        role="slider"
        aria-label="Visible time range"
        aria-valuemin="0"
        aria-valuemax={duration}
        aria-valuenow={(viewStart + viewEnd) / 2}
        tabindex="0"
        onpointerdown={(event) => handleRangePointerDown(event, 'pan')}
        onkeydown={(event) => handleRangeKeydown(event, 'pan')}
      ></div>
      <div
        class="waveform-range-handle start"
        role="slider"
        aria-label="Visible range start"
        aria-valuemin="0"
        aria-valuemax={viewEnd}
        aria-valuenow={viewStart}
        tabindex="0"
        onpointerdown={(event) => handleRangePointerDown(event, 'start')}
        onkeydown={(event) => handleRangeKeydown(event, 'start')}
      ></div>
      <div
        class="waveform-range-handle end"
        role="slider"
        aria-label="Visible range end"
        aria-valuemin={viewStart}
        aria-valuemax={duration}
        aria-valuenow={viewEnd}
        tabindex="0"
        onpointerdown={(event) => handleRangePointerDown(event, 'end')}
        onkeydown={(event) => handleRangeKeydown(event, 'end')}
      ></div>
    </div>
    <div class="playhead" style:left={`${playhead}%`} aria-hidden="true">
      <span>{formatTime(currentTime, true)}</span>
    </div>
  </div>
</section>

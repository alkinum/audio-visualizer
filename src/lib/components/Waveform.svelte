<script lang="ts">
  import { onMount } from 'svelte';
  import type { PeakSeries, ResolvedTheme, WaveformData, WaveformMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    data: WaveformData;
    duration: number;
    currentTime: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
  }

  let { data, duration, currentTime, theme, onSeek }: Props = $props();
  let mode = $state<WaveformMode>('combined');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let seeking = $state(false);
  const height = 176;
  const playhead = $derived(duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0);

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  $effect(() => {
    const currentData = data;
    const currentMode = mode;
    const currentTheme = theme;
    const currentWidth = width;
    if (currentData && currentMode && currentTheme && currentWidth >= 0) draw();
  });

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(container);
    const grid = styles.getPropertyValue('--chart-grid').trim();
    const primary = styles.getPropertyValue('--chart-primary').trim();
    const secondary = styles.getPropertyValue('--chart-secondary').trim();

    context.lineWidth = 1;
    context.strokeStyle = grid;
    for (let step = 1; step < 4; step += 1) {
      const y = Math.round((height * step) / 4) + 0.5;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (mode === 'split') {
      drawSeries(context, data.left, 0, height / 2, primary);
      drawSeries(context, data.right, height / 2, height / 2, secondary);
    } else {
      drawSeries(context, data.combined, 0, height, primary);
    }
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
    if (seeking) seekAt(event);
  }

  function handlePointerUp(event: PointerEvent): void {
    seeking = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
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
      <span class="section-value">{mode === 'combined' ? 'Stereo mix' : 'Left / Right'}</span>
    </div>
    <div class="segmented" aria-label="Waveform channel mode">
      <button class:active={mode === 'combined'} type="button" onclick={() => (mode = 'combined')}>Mix</button>
      <button class:active={mode === 'split'} type="button" onclick={() => (mode = 'split')}>L / R</button>
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
    <div class="playhead" style:left={`${playhead}%`} aria-hidden="true">
      <span>{formatTime(currentTime, true)}</span>
    </div>
  </div>
</section>

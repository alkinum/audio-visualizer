<script lang="ts">
  import { onMount } from 'svelte';
  import type { OfflineAnalysis, ResolvedTheme, SpectrogramMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    analysis: OfflineAnalysis;
    duration: number;
    currentTime: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
  }

  let { analysis, duration, currentTime, theme, onSeek }: Props = $props();
  let mode = $state<SpectrogramMode>('combined');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let seeking = $state(false);
  const baseHeight = 332;
  const splitHeight = 430;
  const height = $derived(mode === 'combined' ? baseHeight : splitHeight);
  const playhead = $derived(duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0);

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  $effect(() => {
    const currentAnalysis = analysis;
    const currentMode = mode;
    const currentTheme = theme;
    const currentWidth = width;
    if (currentAnalysis && currentMode && currentTheme && currentWidth >= 0) draw();
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
    const text = styles.getPropertyValue('--text-faint').trim();
    const channels: Array<'combined' | 'left' | 'right' | 'mid' | 'side'> =
      mode === 'combined' ? ['combined'] : mode === 'lr' ? ['left', 'right'] : ['mid', 'side'];
    const panelHeight = height / channels.length;

    channels.forEach((channel, index) => {
      drawPanel(context, channel, index * panelHeight, panelHeight, grid, text);
    });
  }

  function drawPanel(
    context: CanvasRenderingContext2D,
    channel: 'combined' | 'left' | 'right' | 'mid' | 'side',
    top: number,
    panelHeight: number,
    grid: string,
    text: string,
  ): void {
    const plotHeight = Math.max(1, panelHeight - 22);
    const values = analysis.channels[channel];
    context.fillStyle = getComputedStyle(container).getPropertyValue('--surface-muted').trim();
    context.fillRect(0, top, width, plotHeight);
    const raster = makeSpectrumRaster(values);
    context.imageSmoothingEnabled = false;
    context.drawImage(raster, 0, top, width, plotHeight);

    context.strokeStyle = grid;
    context.lineWidth = 1;
    const frequencies = [20, 100, 1000, 10000];
    frequencies.forEach((frequency) => {
      if (frequency > analysis.sampleRate / 2) return;
      const y = top + plotHeight - frequencyToRatio(frequency) * plotHeight;
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
      context.fillStyle = text;
      context.font = '10px SFMono-Regular, Consolas, monospace';
      context.textAlign = 'left';
      context.textBaseline = 'bottom';
      context.fillText(formatFrequencyLabel(frequency), 8, y - 3);
    });

    context.fillStyle = text;
    context.font = '600 10px SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'top';
    context.fillText(channelLabel(channel), 8, top + 8);

    context.strokeStyle = grid;
    context.beginPath();
    context.moveTo(0, top + plotHeight + 0.5);
    context.lineTo(width, top + plotHeight + 0.5);
    context.stroke();
  }

  function frequencyToRatio(frequency: number): number {
    const min = Math.log(20);
    const max = Math.log(Math.max(20, analysis.sampleRate / 2));
    return Math.max(0, Math.min(1, (Math.log(frequency) - min) / (max - min)));
  }

  function makeSpectrumRaster(values: Float32Array): HTMLCanvasElement {
    const raster = document.createElement('canvas');
    raster.width = analysis.frameCount;
    raster.height = analysis.binCount;
    const rasterContext = raster.getContext('2d');
    if (!rasterContext) return raster;

    const image = rasterContext.createImageData(analysis.frameCount, analysis.binCount);
    const palette = makeHeatPalette();
    const range = analysis.maxDb - analysis.minDb;
    for (let frame = 0; frame < analysis.frameCount; frame += 1) {
      for (let bin = 0; bin < analysis.binCount; bin += 1) {
        const db = values[frame * analysis.binCount + bin];
        const intensity = Math.max(0, Math.min(1, (db - analysis.minDb) / range));
        const colorOffset = Math.round(intensity * 255) * 4;
        const pixelOffset = ((analysis.binCount - 1 - bin) * analysis.frameCount + frame) * 4;
        image.data[pixelOffset] = palette[colorOffset];
        image.data[pixelOffset + 1] = palette[colorOffset + 1];
        image.data[pixelOffset + 2] = palette[colorOffset + 2];
        image.data[pixelOffset + 3] = 255;
      }
    }
    rasterContext.putImageData(image, 0, 0);
    return raster;
  }

  function makeHeatPalette(): Uint8ClampedArray {
    const palette = new Uint8ClampedArray(256 * 4);
    for (let index = 0; index < 256; index += 1) {
      const intensity = index / 255;
      const offset = index * 4;
      const color = intensity < 0.06
        ? [19, 28, 29]
        : hslToRgb(178 - intensity * 148, 57 + intensity * 20, 18 + intensity * 40);
      palette[offset] = color[0];
      palette[offset + 1] = color[1];
      palette[offset + 2] = color[2];
      palette[offset + 3] = 255;
    }
    return palette;
  }

  function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = hue / 60;
    const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
    const [red, green, blue] =
      segment < 1 ? [chroma, secondary, 0]
      : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
      : segment < 4 ? [0, secondary, chroma]
      : segment < 5 ? [secondary, 0, chroma]
      : [chroma, 0, secondary];
    const match = l - chroma / 2;
    return [Math.round((red + match) * 255), Math.round((green + match) * 255), Math.round((blue + match) * 255)];
  }

  function channelLabel(channel: 'combined' | 'left' | 'right' | 'mid' | 'side'): string {
    return ({ combined: 'STEREO MIX', left: 'LEFT', right: 'RIGHT', mid: 'MID', side: 'SIDE' })[channel];
  }

  function formatFrequencyLabel(frequency: number): string {
    return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
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

<section class="viz-section" aria-labelledby="spectrogram-title">
  <div class="section-heading">
    <div>
      <h2 id="spectrogram-title">Spectral history</h2>
      <span class="section-value">20 Hz - {Math.round(analysis.sampleRate / 2000)} kHz</span>
    </div>
    <div class="segmented" aria-label="Spectrogram channel mode">
      <button class:active={mode === 'combined'} type="button" onclick={() => (mode = 'combined')}>Mix</button>
      <button class:active={mode === 'lr'} type="button" onclick={() => (mode = 'lr')}>L / R</button>
      <button class:active={mode === 'ms'} type="button" onclick={() => (mode = 'ms')}>M / S</button>
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

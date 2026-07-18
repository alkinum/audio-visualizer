<script lang="ts">
  import { onMount } from 'svelte';
  import { observeDevicePixelRatio, prepareCanvas } from '$lib/canvas-resolution';
  import { calculateCorrelation, linearRmsDb } from '$lib/audio/metering';
  import type { AnalyzerBank, ResolvedTheme } from '$lib/audio/types';

  interface Props {
    analyzers: AnalyzerBank | null;
    isPlaying: boolean;
    sampleRate: number;
    theme: ResolvedTheme;
  }

  let { analyzers, isPlaying, sampleRate, theme }: Props = $props();
  let responseContainer: HTMLDivElement;
  let phaseContainer: HTMLDivElement;
  let responseCanvas: HTMLCanvasElement;
  let phaseCanvas: HTMLCanvasElement;
  let responseWidth = $state(0);
  let phaseWidth = $state(0);
  let dpr = $state(1);
  let phaseCorrelation = $state(0);
  let hasSignal = $state(false);
  const displayCorrelation = $derived(Math.abs(phaseCorrelation) < 0.005 ? 0 : phaseCorrelation);
  let cachedLeftAnalyzer: AnalyserNode | null = null;
  let cachedRightAnalyzer: AnalyserNode | null = null;
  let cachedMidAnalyzer: AnalyserNode | null = null;
  let cachedSideAnalyzer: AnalyserNode | null = null;
  type AudioBufferView = Float32Array<ArrayBuffer>;
  let leftFrequency: AudioBufferView | null = null;
  let rightFrequency: AudioBufferView | null = null;
  let leftTime: AudioBufferView | null = null;
  let rightTime: AudioBufferView | null = null;

  onMount(() => {
    const responseObserver = new ResizeObserver(([entry]) => {
      responseWidth = entry.contentRect.width;
    });
    const phaseObserver = new ResizeObserver(([entry]) => {
      phaseWidth = entry.contentRect.width;
    });
    responseObserver.observe(responseContainer);
    phaseObserver.observe(phaseContainer);
    const stopDprObserver = observeDevicePixelRatio((ratio) => (dpr = ratio));

    let animationFrame = 0;
    const update = () => {
      if (analyzers && isPlaying) {
        ensureBuffers(analyzers);
        analyzers.left.getFloatFrequencyData(leftFrequency!);
        analyzers.right.getFloatFrequencyData(rightFrequency!);
        analyzers.left.getFloatTimeDomainData(leftTime!);
        analyzers.right.getFloatTimeDomainData(rightTime!);
        phaseCorrelation = calculateCorrelation(leftTime!, rightTime!);
        hasSignal = true;
        drawResponse();
        drawPhase();
      }
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animationFrame);
      responseObserver.disconnect();
      phaseObserver.disconnect();
      stopDprObserver();
    };
  });

  $effect(() => {
    const redraw = { theme, responseWidth, phaseWidth, dpr, analyzers, isPlaying, sampleRate };
    if (redraw.theme && redraw.responseWidth >= 0 && redraw.phaseWidth >= 0 && redraw.sampleRate > 0) {
      drawResponse();
      drawPhase();
    }
  });

  function ensureBuffers(nextAnalyzers: AnalyzerBank): void {
    if (
      cachedLeftAnalyzer === nextAnalyzers.left &&
      cachedRightAnalyzer === nextAnalyzers.right &&
      cachedMidAnalyzer === nextAnalyzers.mid &&
      cachedSideAnalyzer === nextAnalyzers.side
    ) return;
    cachedLeftAnalyzer = nextAnalyzers.left;
    cachedRightAnalyzer = nextAnalyzers.right;
    cachedMidAnalyzer = nextAnalyzers.mid;
    cachedSideAnalyzer = nextAnalyzers.side;
    leftFrequency = new Float32Array(nextAnalyzers.left.frequencyBinCount);
    rightFrequency = new Float32Array(nextAnalyzers.right.frequencyBinCount);
    leftTime = new Float32Array(nextAnalyzers.left.fftSize);
    rightTime = new Float32Array(nextAnalyzers.right.fftSize);
    hasSignal = false;
    phaseCorrelation = 0;
  }

  function drawResponse(): void {
    if (!responseCanvas || !responseContainer || responseWidth <= 0) return;
    const bounds = responseCanvas.getBoundingClientRect();
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const context = prepareCanvas(responseCanvas, cssWidth, cssHeight, dpr);
    if (!context) return;
    const styles = getComputedStyle(responseContainer);
    const background = styles.getPropertyValue('--surface-muted').trim();
    const grid = styles.getPropertyValue('--chart-grid').trim();
    const text = styles.getPropertyValue('--text-faint').trim();
    const accent = styles.getPropertyValue('--chart-primary').trim();
    const secondary = styles.getPropertyValue('--chart-secondary').trim();
    context.fillStyle = background;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const left = 36;
    const right = 12;
    const top = 14;
    const bottom = 28;
    const plotWidth = cssWidth - left - right;
    const plotHeight = cssHeight - top - bottom;
    const minDb = -96;
    const maxDb = 0;

    context.strokeStyle = grid;
    context.lineWidth = 1;
    for (const db of [-96, -72, -48, -24, 0]) {
      const y = top + ((maxDb - db) / (maxDb - minDb)) * plotHeight;
      context.beginPath();
      context.moveTo(left, y + 0.5);
      context.lineTo(left + plotWidth, y + 0.5);
      context.stroke();
      context.fillStyle = text;
      context.font = '10px SFMono-Regular, Consolas, monospace';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(`${db}`, left - 8, y);
    }

    const nyquist = Math.max(20, sampleRate / 2);
    for (const frequency of [20, 100, 1000, 10000]) {
      if (frequency > nyquist) continue;
      const x = left + frequencyRatio(frequency, nyquist) * plotWidth;
      context.beginPath();
      context.moveTo(x + 0.5, top);
      context.lineTo(x + 0.5, top + plotHeight);
      context.stroke();
      context.fillStyle = text;
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.fillText(frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`, x, top + plotHeight + 8);
    }

    if (!leftFrequency || !rightFrequency || !hasSignal) {
      context.fillStyle = text;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('Play audio to monitor', left + plotWidth / 2, top + plotHeight / 2);
      return;
    }

    drawFrequencyLine(context, leftFrequency, rightFrequency, left, top, plotWidth, plotHeight, minDb, maxDb, nyquist, secondary, false);
    drawFrequencyLine(context, leftFrequency, rightFrequency, left, top, plotWidth, plotHeight, minDb, maxDb, nyquist, accent, true);
  }

  function drawFrequencyLine(
    context: CanvasRenderingContext2D,
    leftData: AudioBufferView,
    rightData: AudioBufferView,
    left: number,
    top: number,
    plotWidth: number,
    plotHeight: number,
    minDb: number,
    maxDb: number,
    nyquist: number,
    color: string,
    combined: boolean,
  ): void {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = combined ? 1.8 : 0.8;
    context.globalAlpha = combined ? 0.96 : 0.5;
    for (let x = 0; x <= plotWidth; x += 1) {
      const ratio = x / Math.max(1, plotWidth);
      const frequency = Math.exp(Math.log(20) + ratio * (Math.log(nyquist) - Math.log(20)));
      const index = Math.min(leftData.length - 1, Math.max(0, Math.floor((frequency / nyquist) * leftData.length)));
      const leftDb = leftData[index];
      const rightDb = rightData[index];
      const db = combined ? linearRmsDb(leftDb, rightDb) : leftDb;
      const y = top + ((maxDb - Math.max(minDb, Math.min(maxDb, db))) / (maxDb - minDb)) * plotHeight;
      if (x === 0) context.moveTo(left + x, y);
      else context.lineTo(left + x, y);
    }
    context.stroke();
    context.globalAlpha = 1;

    if (!combined) {
      context.beginPath();
      context.strokeStyle = color;
      context.globalAlpha = 0.5;
      for (let x = 0; x <= plotWidth; x += 1) {
        const ratio = x / Math.max(1, plotWidth);
        const frequency = Math.exp(Math.log(20) + ratio * (Math.log(nyquist) - Math.log(20)));
        const index = Math.min(rightData.length - 1, Math.max(0, Math.floor((frequency / nyquist) * rightData.length)));
        const db = rightData[index];
        const y = top + ((maxDb - Math.max(minDb, Math.min(maxDb, db))) / (maxDb - minDb)) * plotHeight;
        if (x === 0) context.moveTo(left + x, y);
        else context.lineTo(left + x, y);
      }
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  function drawPhase(): void {
    if (!phaseCanvas || !phaseContainer || phaseWidth <= 0) return;
    const bounds = phaseCanvas.getBoundingClientRect();
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const context = prepareCanvas(phaseCanvas, cssWidth, cssHeight, dpr);
    if (!context) return;
    const styles = getComputedStyle(phaseContainer);
    const background = styles.getPropertyValue('--surface-muted').trim();
    const grid = styles.getPropertyValue('--chart-grid').trim();
    const text = styles.getPropertyValue('--text-faint').trim();
    const accent = styles.getPropertyValue('--chart-primary').trim();
    context.fillStyle = background;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const centerX = cssWidth / 2;
    const centerY = cssHeight / 2;
    const radius = Math.min(cssWidth * 0.36, cssHeight * 0.36);
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(centerX - radius, centerY);
    context.lineTo(centerX + radius, centerY);
    context.moveTo(centerX, centerY - radius);
    context.lineTo(centerX, centerY + radius);
    context.stroke();

    context.fillStyle = text;
    context.font = '10px SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillText('L + R', centerX + radius + 8, centerY);
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText('L - R', centerX, centerY - radius - 8);

    if (!leftTime || !rightTime || !hasSignal) {
      context.fillStyle = text;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('Play audio to view phase', centerX, centerY);
      return;
    }

    context.fillStyle = accent;
    context.globalAlpha = 0.7;
    const sampleStep = Math.max(1, Math.floor(leftTime.length / Math.max(512, cssWidth * 2)));
    for (let index = 0; index < leftTime.length; index += sampleStep) {
      const left = leftTime[index];
      const right = rightTime[index];
      const x = centerX + ((left + right) * Math.SQRT1_2) * radius;
      const y = centerY - ((left - right) * Math.SQRT1_2) * radius;
      context.fillRect(x, y, 1.2, 1.2);
    }
    context.globalAlpha = 1;
  }

  function frequencyRatio(frequency: number, nyquist: number): number {
    return Math.max(0, Math.min(1, (Math.log(frequency) - Math.log(20)) / (Math.log(nyquist) - Math.log(20))));
  }

  function correlationLabel(value: number): string {
    if (value > 0.7) return 'In phase';
    if (value < -0.35) return 'Inverted';
    return 'Wide field';
  }
</script>

<section class="live-rack" aria-label="Live analysis">
  <div class="live-panel">
    <div class="section-heading">
      <div>
        <h2>Live response</h2>
        <span class="section-value">-96 dBFS - 0 dBFS</span>
      </div>
      <div class="trace-legend" aria-label="Frequency trace legend">
        <span><i class="trace-line trace-main"></i>Mix</span>
        <span><i class="trace-line trace-secondary"></i>L / R</span>
      </div>
    </div>
    <div bind:this={responseContainer} class="live-canvas canvas-surface">
      <canvas bind:this={responseCanvas} aria-label="Real-time frequency response"></canvas>
    </div>
  </div>
  <div class="live-panel phase-panel">
    <div class="section-heading">
      <div>
        <h2>Phase image</h2>
        <span class="section-value">{displayCorrelation.toFixed(2)} correlation</span>
      </div>
      <span class:signal-active={hasSignal && isPlaying} class="phase-status">{correlationLabel(displayCorrelation)}</span>
    </div>
    <div bind:this={phaseContainer} class="live-canvas phase-canvas canvas-surface">
      <canvas bind:this={phaseCanvas} aria-label="Real-time stereo phase image"></canvas>
    </div>
  </div>
</section>

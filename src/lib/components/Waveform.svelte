<script lang="ts">
  import { onMount } from 'svelte';
  import { MousePointer2, Repeat2 } from '@lucide/svelte';
  import { panAxisRange, zoomAxisRange } from '$lib/audio/chart-viewport';
  import { observeDevicePixelRatio, prepareCanvas } from '$lib/canvas-resolution';
  import type { PeakSeries, ResolvedTheme, WaveformData, WaveformMode } from '$lib/audio/types';
  import { formatTime } from '$lib/format';

  interface Props {
    data: WaveformData;
    comparisonData?: WaveformData | null;
    duration: number;
    comparisonDuration?: number;
    currentTime: number;
    viewStart: number;
    viewEnd: number;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    loopMaximum: number;
    theme: ResolvedTheme;
    onSeek: (time: number) => void;
    onViewChange: (start: number, end: number) => void;
    onLoopChange: (start: number, end: number) => void;
    onLoopToggle: (enabled: boolean) => void;
  }

  type ToolMode = 'navigate' | 'loop';
  type PointerAction =
    | 'pending-navigation'
    | 'pan-view'
    | 'draw-loop'
    | 'pan-loop'
    | 'view-start'
    | 'view-end'
    | 'loop-start'
    | 'loop-end';

  interface PanelRect {
    key: 'a' | 'b';
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
    data: WaveformData;
    sourceDuration: number;
  }

  let {
    data,
    comparisonData = null,
    duration,
    comparisonDuration = 0,
    currentTime,
    viewStart,
    viewEnd,
    loopEnabled,
    loopStart,
    loopEnd,
    loopMaximum,
    theme,
    onSeek,
    onViewChange,
    onLoopChange,
    onLoopToggle,
  }: Props = $props();

  const panelGap = 8;
  let mode = $state<WaveformMode>('combined');
  let tool = $state<ToolMode>('navigate');
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let width = $state(0);
  let dpr = $state(1);
  let pointerAction = $state<PointerAction | null>(null);
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartTime = 0;
  let initialStart = 0;
  let initialEnd = 0;
  let moved = false;
  let loopDrawStarted = false;

  const hasComparison = $derived(Boolean(comparisonData));
  const stacked = $derived(hasComparison && width < 720);
  const canvasHeight = $derived(stacked ? 296 : 176);
  const panels = $derived.by(makePanels);
  const playhead = $derived(duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0);
  const rangeLeft = $derived(duration > 0 ? Math.min(100, Math.max(0, (viewStart / duration) * 100)) : 0);
  const rangeWidth = $derived(
    duration > 0 ? Math.min(100 - rangeLeft, Math.max(0, ((viewEnd - viewStart) / duration) * 100)) : 100,
  );
  const loopLeft = $derived(duration > 0 ? Math.min(100, Math.max(0, (loopStart / duration) * 100)) : 0);
  const loopWidth = $derived(
    duration > 0 ? Math.min(100 - loopLeft, Math.max(0, ((loopEnd - loopStart) / duration) * 100)) : 0,
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
    };
  });

  $effect(() => {
    const redraw = {
      data,
      comparisonData,
      comparisonDuration,
      duration,
      mode,
      theme,
      width,
      dpr,
      canvasHeight,
    };
    if (redraw.data && redraw.theme && redraw.width > 0 && redraw.dpr > 0) draw();
  });

  function makePanels(): PanelRect[] {
    if (width <= 0) return [];
    if (!comparisonData) {
      return [{ key: 'a', label: 'A', left: 0, top: 0, width, height: canvasHeight, data, sourceDuration: duration }];
    }
    if (stacked) {
      const panelHeight = (canvasHeight - panelGap) / 2;
      return [
        { key: 'a', label: 'A', left: 0, top: 0, width, height: panelHeight, data, sourceDuration: duration },
        {
          key: 'b',
          label: 'B',
          left: 0,
          top: panelHeight + panelGap,
          width,
          height: panelHeight,
          data: comparisonData,
          sourceDuration: comparisonDuration,
        },
      ];
    }
    const panelWidth = (width - panelGap) / 2;
    return [
      { key: 'a', label: 'A', left: 0, top: 0, width: panelWidth, height: canvasHeight, data, sourceDuration: duration },
      {
        key: 'b',
        label: 'B',
        left: panelWidth + panelGap,
        top: 0,
        width: panelWidth,
        height: canvasHeight,
        data: comparisonData,
        sourceDuration: comparisonDuration,
      },
    ];
  }

  function draw(): void {
    if (!canvas || !container || width <= 0) return;
    const context = prepareCanvas(canvas, width, canvasHeight, dpr);
    if (!context) return;
    context.clearRect(0, 0, width, canvasHeight);
    const styles = getComputedStyle(container);
    const grid = styles.getPropertyValue('--chart-grid').trim();
    const primary = styles.getPropertyValue('--chart-primary').trim();
    const secondary = styles.getPropertyValue('--chart-secondary').trim();
    const label = styles.getPropertyValue('--text-faint').trim();
    const surface = styles.getPropertyValue('--surface-muted').trim();

    for (const panel of panels) {
      context.save();
      context.beginPath();
      context.rect(panel.left, panel.top, panel.width, panel.height);
      context.clip();
      context.fillStyle = surface;
      context.fillRect(panel.left, panel.top, panel.width, panel.height);
      if (mode === 'split') {
        drawAmplitudeAxis(context, panel.left, panel.top, panel.width, panel.height / 2, grid, label);
        drawAmplitudeAxis(context, panel.left, panel.top + panel.height / 2, panel.width, panel.height / 2, grid, label);
        drawSeries(context, panel.data.left, panel, panel.top, panel.height / 2, primary);
        drawSeries(context, panel.data.right, panel, panel.top + panel.height / 2, panel.height / 2, secondary);
      } else {
        drawAmplitudeAxis(context, panel.left, panel.top, panel.width, panel.height, grid, label);
        drawSeries(context, panel.data.combined, panel, panel.top, panel.height, primary);
      }
      context.restore();
    }
  }

  function drawAmplitudeAxis(
    context: CanvasRenderingContext2D,
    left: number,
    top: number,
    regionWidth: number,
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
        context.moveTo(left, y);
        context.lineTo(left + regionWidth, y);
        context.stroke();
      }
      context.fillText(db === 0 ? '0 dBFS' : `${db}`, left + regionWidth - 6, center - linear * amplitude);
    });

    context.beginPath();
    context.moveTo(left, Math.round(center) + 0.5);
    context.lineTo(left + regionWidth, Math.round(center) + 0.5);
    context.stroke();
    context.restore();
  }

  function drawSeries(
    context: CanvasRenderingContext2D,
    series: PeakSeries,
    panel: PanelRect,
    top: number,
    regionHeight: number,
    color: string,
  ): void {
    if (panel.sourceDuration <= 0 || duration <= 0) return;
    const center = top + regionHeight / 2;
    const amplitude = regionHeight * 0.42;
    context.strokeStyle = color;
    context.globalAlpha = 0.9;
    context.beginPath();

    for (let localX = 0; localX < panel.width; localX += 1) {
      const time = (localX / Math.max(1, panel.width - 1)) * duration;
      if (time > panel.sourceDuration) continue;
      const index = Math.min(
        series.min.length - 1,
        Math.floor((time / panel.sourceDuration) * Math.max(0, series.min.length - 1)),
      );
      const x = panel.left + localX + 0.5;
      context.moveTo(x, center - series.max[index] * amplitude);
      context.lineTo(x, center - series.min[index] * amplitude);
    }

    context.stroke();
    context.globalAlpha = 1;
  }

  function panelAt(clientX: number, clientY: number): PanelRect {
    const bounds = container.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    return panels.find((panel) => x >= panel.left && x <= panel.left + panel.width && y >= panel.top && y <= panel.top + panel.height)
      ?? panels[0];
  }

  function timeAt(clientX: number, clientY: number): number {
    const bounds = container.getBoundingClientRect();
    const panel = panelAt(clientX, clientY);
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - panel.left) / panel.width));
    return ratio * duration;
  }

  function beginPointer(event: PointerEvent, action?: PointerAction): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerAction = action ?? (tool === 'loop' ? 'draw-loop' : 'pending-navigation');
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerStartTime = timeAt(event.clientX, event.clientY);
    initialStart = pointerAction.startsWith('loop') || pointerAction === 'draw-loop' ? loopStart : viewStart;
    initialEnd = pointerAction.startsWith('loop') || pointerAction === 'draw-loop' ? loopEnd : viewEnd;
    moved = false;
    loopDrawStarted = false;
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
    }
    if (pointerAction === 'pending-navigation' && moved) pointerAction = 'pan-view';
    if (!moved) return;
    event.preventDefault();

    const panel = panelAt(pointerStartX, pointerStartY);
    if (pointerAction === 'pan-view') {
      const span = initialEnd - initialStart;
      const range = panAxisRange(
        { start: initialStart, end: initialEnd },
        -(deltaX / panel.width) * span,
        0,
        duration,
        minimumViewSpan(),
      );
      onViewChange(range.start, range.end);
      return;
    }

    if (pointerAction === 'draw-loop') {
      if (!loopDrawStarted) {
        loopDrawStarted = true;
        onLoopToggle(true);
      }
      const nextTime = Math.max(0, Math.min(loopMaximum, timeAt(event.clientX, event.clientY)));
      const start = Math.min(pointerStartTime, nextTime);
      const end = Math.max(pointerStartTime, nextTime);
      onLoopChange(start, Math.max(start + minimumLoopSpan(), Math.min(loopMaximum, end)));
      return;
    }

    const deltaTime = (deltaX / panel.width) * duration;
    if (pointerAction === 'pan-loop') {
      const range = panAxisRange(
        { start: initialStart, end: initialEnd },
        deltaTime,
        0,
        loopMaximum,
        minimumLoopSpan(),
      );
      onLoopChange(range.start, range.end);
    } else if (pointerAction === 'view-start') {
      onViewChange(Math.max(0, Math.min(initialEnd - minimumViewSpan(), initialStart + deltaTime)), initialEnd);
    } else if (pointerAction === 'view-end') {
      onViewChange(initialStart, Math.min(duration, Math.max(initialStart + minimumViewSpan(), initialEnd + deltaTime)));
    } else if (pointerAction === 'loop-start') {
      onLoopChange(Math.max(0, Math.min(initialEnd - minimumLoopSpan(), initialStart + deltaTime)), initialEnd);
    } else if (pointerAction === 'loop-end') {
      onLoopChange(initialStart, Math.min(loopMaximum, Math.max(initialStart + minimumLoopSpan(), initialEnd + deltaTime)));
    }
  }

  function endPointer(event: PointerEvent): void {
    const completedAction = pointerAction;
    pointerAction = null;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel') return;
    if (completedAction === 'pending-navigation' && !moved) onSeek(timeAt(event.clientX, event.clientY));
    if (completedAction === 'draw-loop' && !moved) {
      const span = Math.min(loopMaximum, Math.max(1, loopMaximum * 0.05));
      const start = Math.max(0, Math.min(loopMaximum - span, pointerStartTime - span / 2));
      onLoopChange(start, start + span);
      onLoopToggle(true);
    }
  }

  function cancelPointer(event: PointerEvent): void {
    pointerAction = null;
    moved = false;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  }

  function minimumViewSpan(): number {
    return Math.min(duration, Math.max(0.25, duration / 200));
  }

  function minimumLoopSpan(): number {
    return Math.min(loopMaximum, Math.max(0.05, loopMaximum / 1000));
  }

  function handleWheel(event: WheelEvent): void {
    if (duration <= 0 || panels.length === 0) return;
    const panel = panelAt(event.clientX, event.clientY);
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.65;
    if (horizontal && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const span = viewEnd - viewStart;
      const range = panAxisRange(
        { start: viewStart, end: viewEnd },
        (event.deltaX / panel.width) * span,
        0,
        duration,
        minimumViewSpan(),
      );
      onViewChange(range.start, range.end);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) > 0) {
      event.preventDefault();
      const factor = Math.exp(Math.max(-240, Math.min(240, event.deltaY)) * 0.0018);
      const anchor = timeAt(event.clientX, event.clientY);
      const range = zoomAxisRange(
        { start: viewStart, end: viewEnd },
        factor,
        anchor,
        0,
        duration,
        minimumViewSpan(),
      );
      onViewChange(range.start, range.end);
    }
  }

  function chooseTool(nextTool: ToolMode): void {
    tool = nextTool;
    if (nextTool === 'loop' && !loopEnabled) {
      const span = Math.min(loopMaximum, Math.max(1, loopMaximum * 0.1));
      const start = Math.max(0, Math.min(loopMaximum - span, currentTime));
      onLoopChange(start, start + span);
      onLoopToggle(true);
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
  <div class="section-heading waveform-heading">
    <div>
      <h2 id="waveform-title">Waveform</h2>
      <span class="section-value">
        {hasComparison ? 'A / B overview' : 'A overview'} · {formatTime(viewStart, true)} - {formatTime(viewEnd, true)}
      </span>
    </div>
    <div class="waveform-heading-tools">
      <div class="segmented" aria-label="Waveform channel mode">
        <button class:active={mode === 'combined'} type="button" aria-pressed={mode === 'combined'} onclick={() => (mode = 'combined')}>Mix</button>
        <button class:active={mode === 'split'} type="button" aria-pressed={mode === 'split'} onclick={() => (mode = 'split')}>L / R</button>
      </div>
      <div class="segmented waveform-tools" aria-label="Waveform interaction tool">
        <button class:active={tool === 'navigate'} type="button" aria-pressed={tool === 'navigate'} aria-label="Navigate waveform" title="Navigate waveform" onclick={() => chooseTool('navigate')}>
          <MousePointer2 size={14} strokeWidth={1.8} />
        </button>
        <button class:active={tool === 'loop'} type="button" aria-pressed={tool === 'loop'} aria-label="Draw loop range" title="Draw loop range" onclick={() => chooseTool('loop')}>
          <Repeat2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  </div>
  <div
    bind:this={container}
    class:dragging={Boolean(pointerAction)}
    class:loop-tool={tool === 'loop'}
    class:comparison={hasComparison}
    class:stacked
    class="waveform-canvas canvas-surface"
    style:height={`${canvasHeight + 2}px`}
    role="slider"
    aria-label="Audio position"
    aria-valuemin="0"
    aria-valuemax={duration}
    aria-valuenow={currentTime}
    aria-valuetext={formatTime(currentTime, true)}
    tabindex="0"
    onpointerdown={(event) => beginPointer(event)}
    onpointermove={handlePointerMove}
    onpointerup={endPointer}
    onpointercancel={endPointer}
    onkeydown={handleKeydown}
  >
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#each panels as panel, index (panel.key)}
      <div
        class="waveform-panel-overlay"
        class:source-b={panel.key === 'b'}
        style:left={`${panel.left}px`}
        style:top={`${panel.top}px`}
        style:width={`${panel.width}px`}
        style:height={`${panel.height}px`}
        aria-hidden={index > 0 ? 'true' : undefined}
      >
        <span class="waveform-source-tag">{panel.label}</span>
        <div class="waveform-window" style:left={`${rangeLeft}%`} style:width={`${rangeWidth}%`}>
          {#if index === 0}
            <div class="waveform-range-handle start" role="slider" aria-label="Visible range start" aria-valuemin="0" aria-valuemax={viewEnd} aria-valuenow={viewStart} tabindex="0" onpointerdown={(event) => { event.stopPropagation(); beginPointer(event, 'view-start'); }}></div>
            <div class="waveform-range-handle end" role="slider" aria-label="Visible range end" aria-valuemin={viewStart} aria-valuemax={duration} aria-valuenow={viewEnd} tabindex="0" onpointerdown={(event) => { event.stopPropagation(); beginPointer(event, 'view-end'); }}></div>
          {/if}
        </div>
        {#if loopEnabled}
          <div class="waveform-loop" style:left={`${loopLeft}%`} style:width={`${loopWidth}%`}>
            {#if index === 0 && tool === 'loop'}
              <button type="button" tabindex="-1" class="waveform-loop-grip" aria-label="Move loop range" onpointerdown={(event) => { event.stopPropagation(); beginPointer(event, 'pan-loop'); }}></button>
              <button type="button" tabindex="-1" class="waveform-loop-handle start" aria-label="Resize loop start" onpointerdown={(event) => { event.stopPropagation(); beginPointer(event, 'loop-start'); }}></button>
              <button type="button" tabindex="-1" class="waveform-loop-handle end" aria-label="Resize loop end" onpointerdown={(event) => { event.stopPropagation(); beginPointer(event, 'loop-end'); }}></button>
            {/if}
          </div>
        {/if}
        <div class="playhead" style:left={`${playhead}%`} aria-hidden="true">
          {#if index === 0}<span>{formatTime(currentTime, true)}</span>{/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<script lang="ts">
  import { onMount } from 'svelte';
  import { LoaderCircle } from '@lucide/svelte';
  import type { AnalysisPlan, AnalysisProgress } from '$lib/audio/types';

  interface Props {
    progress: AnalysisProgress;
    plan: AnalysisPlan;
    startedAt: number;
  }

  let { progress, plan, startedAt }: Props = $props();
  let now = $state(0);
  const elapsedMs = $derived(Math.max(progress.elapsedMs, now > 0 ? now - startedAt : 0));

  onMount(() => {
    now = performance.now();
    const interval = window.setInterval(() => (now = performance.now()), 250);
    return () => window.clearInterval(interval);
  });

  function stageLabel(stage: AnalysisProgress['stage']): string {
    switch (stage) {
      case 'starting':
        return 'Starting analysis worker';
      case 'transferring':
        return 'Transferring channel data';
      case 'finalizing':
        return 'Validating spectrum data';
      default:
        return `Analyzing frame ${progress.frame.toLocaleString()} of ${progress.totalFrames.toLocaleString()}`;
    }
  }

  function formatElapsed(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }

  function formatMemory(bytes: number): string {
    return bytes >= 1024 * 1024 * 1024
      ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
      : `${Math.ceil(bytes / (1024 * 1024))} MB`;
  }
</script>

<section class="viz-section analysis-pending" aria-labelledby="analysis-pending-title" aria-live="polite">
  <div class="section-heading">
    <div>
      <h2 id="analysis-pending-title">Spectral history</h2>
      <span class="section-value">High-resolution offline analysis</span>
    </div>
    <span class="analysis-quality">{plan.quality}</span>
  </div>

  <div class="analysis-pending-surface canvas-surface">
    <div class="analysis-pending-status">
      <span class="analysis-spinner" aria-hidden="true">
        <LoaderCircle size={18} strokeWidth={1.7} />
      </span>
      <div>
        <strong>{stageLabel(progress.stage)}</strong>
        <span>{formatElapsed(elapsedMs)} elapsed</span>
      </div>
      <b>{progress.progress}%</b>
    </div>

    <div
      class="analysis-progress-track"
      role="progressbar"
      aria-label="Spectrum analysis progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={progress.progress}
    >
      <span style:width={`${progress.progress}%`}></span>
    </div>

    <dl class="analysis-plan-grid">
      <div>
        <dt>FFT</dt>
        <dd>{plan.fftSize.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Frequency</dt>
        <dd>{plan.binCount.toLocaleString()} bins</dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>{plan.frameCount.toLocaleString()} frames</dd>
      </div>
      <div>
        <dt>Worker memory</dt>
        <dd>~{formatMemory(plan.estimatedWorkerBytes)}</dd>
      </div>
    </dl>
  </div>
</section>

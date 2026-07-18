<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertTriangle, AudioWaveform, Check, CodeXml, Copy, Moon, Pause, Play, Sun } from '@lucide/svelte';
  import AnalysisPending from '$lib/components/AnalysisPending.svelte';
  import FileDropzone from '$lib/components/FileDropzone.svelte';
  import LiveRack from '$lib/components/LiveRack.svelte';
  import Spectrogram from '$lib/components/Spectrogram.svelte';
  import Waveform from '$lib/components/Waveform.svelte';
  import {
    analyzeAudioBuffer,
    AudioAnalysisError,
    formatAudioAnalysisDiagnostics,
    type AnalysisTask,
  } from '$lib/audio/analysis';
  import { decodeAudioFile } from '$lib/audio/decode';
  import { PlaybackEngine } from '$lib/audio/playback';
  import type { AnalysisProgress, AnalyzerBank, DecodedAudio, PlaybackSnapshot, ResolvedTheme } from '$lib/audio/types';
  import { formatBytes, formatFrequency, formatTime } from '$lib/format';

  const EMPTY_PLAYBACK: PlaybackSnapshot = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  };

  let decoded = $state<DecodedAudio | null>(null);
  let selectedFile = $state<File | null>(null);
  let playback = $state<PlaybackSnapshot>({ ...EMPTY_PLAYBACK });
  let engine = $state<PlaybackEngine | null>(null);
  let busy = $state(false);
  let error = $state('');
  let theme = $state<ResolvedTheme>('dark');
  let analysisProgress = $state<AnalysisProgress | null>(null);
  let analysisTask = $state<AnalysisTask | null>(null);
  let analysisFailure = $state<AudioAnalysisError | null>(null);
  let diagnosticsCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let analyzers = $state<AnalyzerBank | null>(null);
  let decodeGeneration = 0;

  onMount(() => {
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const saved = localStorage.getItem('audio-visualizer-theme') as ResolvedTheme | null;
    theme = saved ?? (mediaQuery.matches ? 'dark' : 'light');
    applyTheme(theme);

    const handleSystemTheme = (event: MediaQueryListEvent) => {
      if (localStorage.getItem('audio-visualizer-theme')) return;
      theme = event.matches ? 'dark' : 'light';
      applyTheme(theme);
    };
    mediaQuery.addEventListener('change', handleSystemTheme);

    let animationFrame = 0;
    const updatePlayback = () => {
      if (engine?.snapshot.isPlaying) playback = engine.snapshot;
      animationFrame = requestAnimationFrame(updatePlayback);
    };
    animationFrame = requestAnimationFrame(updatePlayback);

    const handleKeyboard = (event: KeyboardEvent) => {
      if (!engine) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"], [role="slider"]')) return;

      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        const direction = event.code === 'ArrowLeft' ? -1 : 1;
        void seek(playback.currentTime + direction * 5);
      }
    };
    window.addEventListener('keydown', handleKeyboard);

    return () => {
      cancelAnimationFrame(animationFrame);
      mediaQuery.removeEventListener('change', handleSystemTheme);
      window.removeEventListener('keydown', handleKeyboard);
      analysisTask?.cancel();
      void engine?.destroy();
    };
  });

  function applyTheme(nextTheme: ResolvedTheme): void {
    document.documentElement.dataset.theme = nextTheme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', nextTheme === 'dark' ? '#111414' : '#f3f6f5');
  }

  function toggleTheme(): void {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('audio-visualizer-theme', theme);
    applyTheme(theme);
  }

  async function handleFile(file: File): Promise<void> {
    if (!isAudioFile(file)) {
      error = 'Choose a supported audio file.';
      return;
    }

    const generation = ++decodeGeneration;
    busy = true;
    error = '';
    analysisTask?.cancel();
    analysisTask = null;
    analysisProgress = null;
    analysisFailure = null;
    diagnosticsCopyState = 'idle';
    selectedFile = file;
    decoded = null;
    analyzers = null;
    playback = { ...EMPTY_PLAYBACK };
    await engine?.destroy();
    engine = null;
    let decodeComplete = false;

    try {
      const nextAudio = await decodeAudioFile(file);
      if (generation !== decodeGeneration) return;

      decodeComplete = true;
      decoded = nextAudio;
      engine = new PlaybackEngine(nextAudio.buffer, () => {
        if (engine) playback = engine.snapshot;
      });
      playback = engine.snapshot;
      busy = false;

      const task = analyzeAudioBuffer(nextAudio.buffer, (progress) => {
        if (generation === decodeGeneration) analysisProgress = progress;
      }, {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      });
      analysisTask = task;
      const analysis = await task.promise;
      if (generation !== decodeGeneration) return;
      decoded = { ...nextAudio, analysis };
      analysisProgress = {
        stage: 'finalizing',
        progress: 100,
        frame: analysis.frameCount,
        totalFrames: analysis.frameCount,
        elapsedMs: performance.now() - task.startedAt,
      };
      analysisTask = null;
    } catch (cause) {
      if (generation !== decodeGeneration) return;
      if (decodeComplete) {
        if (cause instanceof AudioAnalysisError) {
          analysisFailure = cause;
        } else {
          console.error('Spectrum analysis failed', cause);
          error = 'Spectrum analysis failed. Playback and waveform remain available.';
        }
        analysisTask = null;
      } else {
        console.error('Audio decode failed', cause);
        error = 'This file could not be decoded by the browser.';
        selectedFile = null;
      }
    } finally {
      if (generation === decodeGeneration) busy = false;
    }
  }

  async function togglePlayback(): Promise<void> {
    if (!engine) return;
    try {
      playback = await engine.toggle();
      analyzers = engine.analyzers;
    } catch (cause) {
      console.error('Playback failed', cause);
      error = 'Playback could not start. Check browser audio permissions.';
    }
  }

  async function seek(time: number): Promise<void> {
    if (!engine) return;
    playback = await engine.seek(Math.max(0, Math.min(playback.duration, time)));
  }

  function isAudioFile(file: File): boolean {
    return file.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(file.name);
  }

  async function copyAnalysisDiagnostics(): Promise<void> {
    if (!analysisFailure) return;

    try {
      await navigator.clipboard.writeText(formatAudioAnalysisDiagnostics(analysisFailure));
      diagnosticsCopyState = 'copied';
    } catch (cause) {
      diagnosticsCopyState = 'failed';
      console.error('Could not copy analysis diagnostics', cause);
    }
  }
</script>

<svelte:head>
  <title>Audio Visualizer</title>
  <meta
    name="description"
    content="Local waveform and spectrum analysis for stereo audio files."
  />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand" aria-label="Audio Visualizer">
        <span class="brand-mark" aria-hidden="true">
          <AudioWaveform size={19} strokeWidth={1.7} />
        </span>
        <span>Audio Visualizer</span>
      </div>
      <div class="topbar-actions">
        <span class="privacy-note">Local processing</span>
        <a
          class="icon-button"
          href="https://github.com/alkinum/audio-visualizer"
          target="_blank"
          rel="noreferrer"
          aria-label="Open source repository"
          title="Source repository"
        >
          <CodeXml size={17} strokeWidth={1.7} />
        </a>
        <button
          class="icon-button"
          type="button"
          onclick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {#if theme === 'dark'}
            <Sun size={17} strokeWidth={1.7} />
          {:else}
            <Moon size={17} strokeWidth={1.7} />
          {/if}
        </button>
      </div>
    </div>
  </header>

  <main class:has-session={Boolean(decoded)}>
    {#if !decoded}
      <section class="empty-workspace" aria-labelledby="open-file-title">
        <div class="empty-copy">
          <span class="empty-icon" aria-hidden="true">
            <AudioWaveform size={30} strokeWidth={1.45} />
          </span>
          <h1 id="open-file-title">Audio workspace</h1>
          <p>Load a file to begin a local analysis session.</p>
        </div>
        <FileDropzone onSelect={handleFile} {busy} />
        {#if error}
          <p class="inline-error" role="alert">{error}</p>
        {/if}
      </section>
    {:else}
      <div class="workspace">
        <section class="session-bar" aria-label="Audio file">
          <div class="file-identity">
            <AudioWaveform size={18} strokeWidth={1.7} aria-hidden="true" />
            <div>
              <strong>{selectedFile?.name}</strong>
              <span>
                {formatBytes(selectedFile?.size ?? 0)}
                <i></i>
                {formatFrequency(decoded.buffer.sampleRate)}
                <i></i>
                {decoded.buffer.numberOfChannels === 1 ? 'Mono' : `${decoded.buffer.numberOfChannels} channels`}
              </span>
            </div>
          </div>
          <FileDropzone onSelect={handleFile} {busy} compact />
        </section>

        {#if error}
          <p class="inline-error session-error" role="alert">{error}</p>
        {/if}

        <section class="transport" aria-label="Playback controls">
          <button
            class="transport-play"
            type="button"
            onclick={() => void togglePlayback()}
            aria-label={playback.isPlaying ? 'Pause' : 'Play'}
            title={playback.isPlaying ? 'Pause' : 'Play'}
          >
            {#if playback.isPlaying}
              <Pause size={17} fill="currentColor" strokeWidth={1.6} />
            {:else}
              <Play size={18} fill="currentColor" strokeWidth={1.6} />
            {/if}
          </button>
          <time class="transport-time" datetime={`PT${playback.currentTime}S`}>
            {formatTime(playback.currentTime, true)}
          </time>
          <label class="transport-range">
            <span class="visually-hidden">Playback position</span>
            <input
              type="range"
              min="0"
              max={playback.duration}
              step="0.01"
              value={playback.currentTime}
              oninput={(event) => void seek(Number(event.currentTarget.value))}
            />
          </label>
          <time class="transport-duration" datetime={`PT${playback.duration}S`}>
            {formatTime(playback.duration)}
          </time>
          <span class:active={playback.isPlaying} class="transport-state">
            {playback.isPlaying ? 'Playing' : 'Ready'}
          </span>
        </section>

        <Waveform
          data={decoded.waveform}
          duration={playback.duration}
          currentTime={playback.currentTime}
          {theme}
          onSeek={(time) => void seek(time)}
        />
        {#if decoded.analysis}
          <Spectrogram
            analysis={decoded.analysis}
            duration={playback.duration}
            currentTime={playback.currentTime}
            {theme}
            onSeek={(time) => void seek(time)}
          />
        {:else if analysisFailure}
          <section class="viz-section analysis-failure" aria-labelledby="analysis-failure-title" role="alert">
            <div class="analysis-failure-heading">
              <span class="analysis-failure-icon" aria-hidden="true">
                <AlertTriangle size={18} strokeWidth={1.7} />
              </span>
              <div>
                <h2 id="analysis-failure-title">Spectrum analysis stopped</h2>
                <p>{analysisFailure.message}</p>
                <span>Playback and waveform remain available.</span>
              </div>
              <button class="diagnostics-copy" type="button" onclick={() => void copyAnalysisDiagnostics()}>
                {#if diagnosticsCopyState === 'copied'}
                  <Check size={15} strokeWidth={1.8} aria-hidden="true" />
                  Copied
                {:else}
                  <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
                  {diagnosticsCopyState === 'failed' ? 'Copy failed' : 'Copy diagnostics'}
                {/if}
              </button>
            </div>
            <details class="analysis-diagnostics">
              <summary>Technical details</summary>
              <pre>{formatAudioAnalysisDiagnostics(analysisFailure)}</pre>
            </details>
          </section>
        {:else if analysisProgress && analysisTask}
          <AnalysisPending progress={analysisProgress} plan={analysisTask.plan} startedAt={analysisTask.startedAt} />
        {/if}
        <LiveRack
          {analyzers}
          isPlaying={playback.isPlaying}
          sampleRate={decoded.buffer.sampleRate}
          {theme}
        />
      </div>
    {/if}
  </main>
</div>

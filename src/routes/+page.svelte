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
  import { clampAxisRange } from '$lib/audio/chart-viewport';
  import { PlaybackEngine } from '$lib/audio/playback';
  import type {
    AnalysisProgress,
    AnalyzerBank,
    AuditionChannel,
    AuditionFilterMode,
    ComparisonSlot,
    DecodedAudio,
    PlaybackSnapshot,
    ResolvedTheme,
  } from '$lib/audio/types';
  import { formatBytes, formatFrequency, formatTime } from '$lib/format';

  const EMPTY_PLAYBACK: PlaybackSnapshot = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  };

  let decoded = $state<DecodedAudio | null>(null);
  let selectedFile = $state<File | null>(null);
  let comparisonDecoded = $state<DecodedAudio | null>(null);
  let comparisonFile = $state<File | null>(null);
  let comparisonBusy = $state(false);
  let comparisonError = $state('');
  let activeSlot = $state<ComparisonSlot>('a');
  let auditionChannel = $state<AuditionChannel>('stereo');
  let auditionFilter = $state<AuditionFilterMode>('off');
  let highpassFrequency = $state(10_000);
  let lowpassFrequency = $state(250);
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
  let viewStart = $state(0);
  let viewEnd = $state(0);
  let frequencyMin = $state(0);
  let frequencyMax = $state(0);
  let decodeGeneration = 0;
  let comparisonGeneration = 0;
  let pageDragging = $state(false);

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
      } else if (event.code === 'KeyA') {
        switchComparison('a');
      } else if (event.code === 'KeyB' && comparisonDecoded) {
        switchComparison('b');
      }
    };
    window.addEventListener('keydown', handleKeyboard);

    const handleWindowDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      pageDragging = true;
    };
    const handleWindowDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      pageDragging = true;
    };
    const handleWindowDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) pageDragging = false;
    };
    const handleWindowDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      pageDragging = false;
      const files = Array.from(event.dataTransfer?.files ?? []).slice(0, 2);
      if (!decoded) handleInitialFiles(files);
      else if (files[0]) routeDroppedFile(files[0], activeSlot);
    };
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      cancelAnimationFrame(animationFrame);
      mediaQuery.removeEventListener('change', handleSystemTheme);
      window.removeEventListener('keydown', handleKeyboard);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
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
    activeSlot = 'a';
    viewStart = 0;
    viewEnd = 0;
    frequencyMin = 0;
    frequencyMax = 0;
    playback = { ...EMPTY_PLAYBACK };
    await engine?.destroy();
    engine = null;
    let decodeComplete = false;

    try {
      const nextAudio = await decodeAudioFile(file);
      if (generation !== decodeGeneration) return;

      decodeComplete = true;
      decoded = nextAudio;
      viewEnd = nextAudio.buffer.duration;
      frequencyMax = nextAudio.buffer.sampleRate / 2;
      engine = new PlaybackEngine(nextAudio.buffer, () => {
        if (engine) playback = engine.snapshot;
      }, comparisonDecoded?.buffer ?? null);
      engine.setAuditionChannel(auditionChannel);
      engine.setAuditionFilter('highpass', highpassFrequency);
      engine.setAuditionFilter('lowpass', lowpassFrequency);
      engine.setAuditionFilter(auditionFilter, currentFilterFrequency());
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

  async function handleComparisonFile(file: File): Promise<void> {
    if (!isAudioFile(file)) {
      comparisonError = 'Choose a supported audio file for B.';
      return;
    }

    const generation = ++comparisonGeneration;
    comparisonBusy = true;
    comparisonError = '';
    comparisonFile = file;
    comparisonDecoded = null;
    switchComparison('a');
    engine?.setComparisonBuffer(null);

    try {
      const nextAudio = await decodeAudioFile(file);
      if (generation !== comparisonGeneration) return;
      comparisonDecoded = nextAudio;
      playback = engine?.setComparisonBuffer(nextAudio.buffer) ?? playback;
    } catch (cause) {
      if (generation !== comparisonGeneration) return;
      console.error('Comparison audio decode failed', cause);
      comparisonError = 'B could not be decoded by the browser.';
      comparisonFile = null;
    } finally {
      if (generation === comparisonGeneration) comparisonBusy = false;
    }
  }

  function handleInitialFiles(files: File[]): void {
    const [primary, comparison] = files.slice(0, 2);
    if (primary) void handleFile(primary);
    if (comparison) void handleComparisonFile(comparison);
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

  function switchComparison(slot: ComparisonSlot): void {
    if (slot === 'b' && !comparisonDecoded) return;
    activeSlot = slot;
    playback = engine?.setActiveSlot(slot) ?? playback;
  }

  function changeAuditionChannel(channel: AuditionChannel): void {
    auditionChannel = channel;
    playback = engine?.setAuditionChannel(channel) ?? playback;
  }

  function changeAuditionFilter(mode: AuditionFilterMode): void {
    auditionFilter = mode;
    playback = engine?.setAuditionFilter(mode, currentFilterFrequency()) ?? playback;
  }

  function changeFilterFrequency(sliderRatio: number): void {
    const nyquist = decoded?.buffer.sampleRate ? decoded.buffer.sampleRate / 2 : 24_000;
    const frequency = 20 * Math.pow(nyquist / 20, Math.max(0, Math.min(1, sliderRatio)));
    if (auditionFilter === 'highpass') highpassFrequency = frequency;
    if (auditionFilter === 'lowpass') lowpassFrequency = frequency;
    playback = engine?.setAuditionFilter(auditionFilter, frequency) ?? playback;
  }

  function filterSliderRatio(): number {
    const nyquist = decoded?.buffer.sampleRate ? decoded.buffer.sampleRate / 2 : 24_000;
    return Math.log(currentFilterFrequency() / 20) / Math.log(nyquist / 20);
  }

  function currentFilterFrequency(): number {
    return auditionFilter === 'highpass' ? highpassFrequency : lowpassFrequency;
  }

  function changeTimeView(start: number, end: number): void {
    if (!decoded || decoded.buffer.duration <= 0) return;
    const duration = decoded.buffer.duration;
    const range = clampAxisRange(
      { start, end },
      0,
      duration,
      Math.min(duration, Math.max(0.25, duration / 200)),
    );
    viewStart = range.start;
    viewEnd = range.end;
  }

  function changeFrequencyView(minimum: number, maximum: number): void {
    if (!decoded) return;
    const nyquist = decoded.buffer.sampleRate / 2;
    const range = clampAxisRange(
      { start: minimum, end: maximum },
      0,
      nyquist,
      Math.min(nyquist, Math.max(500, nyquist / 32)),
    );
    frequencyMin = range.start;
    frequencyMax = range.end;
  }

  function isAudioFile(file: File): boolean {
    return file.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(file.name);
  }

  function hasDraggedFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  function handlePageDrop(event: DragEvent, slot: ComparisonSlot): void {
    event.preventDefault();
    event.stopPropagation();
    pageDragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []).slice(0, 2);
    if (!decoded && slot === 'a') handleInitialFiles(files);
    else if (files[0]) routeDroppedFile(files[0], slot);
  }

  function routeDroppedFile(file: File, slot: ComparisonSlot): void {
    if (slot === 'b' && decoded) {
      void handleComparisonFile(file);
    } else {
      void handleFile(file);
    }
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
          <h1 id="open-file-title">Audio Visualizer</h1>
          <p>Load a file to begin a local analysis session.</p>
        </div>
        <FileDropzone
          onSelect={handleFile}
          onSelectMultiple={handleInitialFiles}
          {busy}
          multiple
        />
        {#if error}
          <p class="inline-error" role="alert">{error}</p>
        {/if}
      </section>
    {:else}
      <div class="workspace">
        <section class="session-bar" aria-label="Audio file">
          <div class="comparison-files" aria-label="Comparison sources">
            <button
              class:active={activeSlot === 'a'}
              class="comparison-file"
              type="button"
              aria-pressed={activeSlot === 'a'}
              onclick={() => switchComparison('a')}
            >
              <span class="source-badge">A</span>
              <span class="comparison-file-copy">
                <strong>{selectedFile?.name}</strong>
                <span>
                  {formatBytes(selectedFile?.size ?? 0)}
                  <i></i>
                  {formatFrequency(decoded.buffer.sampleRate)}
                  <i></i>
                  {formatTime(decoded.buffer.duration)}
                </span>
              </span>
            </button>
            {#if comparisonDecoded && comparisonFile}
              <button
                class:active={activeSlot === 'b'}
                class="comparison-file"
                type="button"
                aria-pressed={activeSlot === 'b'}
                onclick={() => switchComparison('b')}
              >
                <span class="source-badge">B</span>
                <span class="comparison-file-copy">
                  <strong>{comparisonFile.name}</strong>
                  <span>
                    {formatBytes(comparisonFile.size)}
                    <i></i>
                    {formatFrequency(comparisonDecoded.buffer.sampleRate)}
                    <i></i>
                    {formatTime(comparisonDecoded.buffer.duration)}
                  </span>
                </span>
              </button>
            {:else}
              <div class:loading={comparisonBusy} class="comparison-file comparison-empty">
                <span class="source-badge">B</span>
                <span class="comparison-file-copy">
                  <strong>{comparisonBusy ? 'Decoding comparison' : 'No comparison file'}</strong>
                  <span>{comparisonBusy ? comparisonFile?.name : 'Optional listening reference'}</span>
                </span>
              </div>
            {/if}
          </div>
          <div class="session-file-actions">
            <FileDropzone onSelect={handleFile} {busy} compact label="Replace A" />
            <FileDropzone
              onSelect={handleComparisonFile}
              busy={comparisonBusy}
              compact
              label={comparisonBusy ? 'Loading B' : comparisonDecoded ? 'Replace B' : 'Add B'}
            />
          </div>
        </section>

        {#if error}
          <p class="inline-error session-error" role="alert">{error}</p>
        {/if}
        {#if comparisonError}
          <p class="inline-error session-error" role="alert">{comparisonError}</p>
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
          <div class="segmented ab-switch" aria-label="Listening source">
            <button
              class:active={activeSlot === 'a'}
              type="button"
              aria-pressed={activeSlot === 'a'}
              onclick={() => switchComparison('a')}
            >A</button>
            <button
              class:active={activeSlot === 'b'}
              type="button"
              aria-pressed={activeSlot === 'b'}
              disabled={!comparisonDecoded}
              onclick={() => switchComparison('b')}
              title={comparisonDecoded ? 'Listen to B' : 'Load a B file first'}
            >B</button>
          </div>
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
            {playback.isPlaying ? `Playing ${activeSlot.toUpperCase()}` : `Ready ${activeSlot.toUpperCase()}`}
          </span>
        </section>

        <section class="audition-strip" aria-label="Audition controls">
          <div class="audition-group">
            <span class="audition-label">Monitor</span>
            <div class="segmented monitor-modes" aria-label="Playback channel">
              <button
                class:active={auditionChannel === 'stereo'}
                type="button"
                aria-pressed={auditionChannel === 'stereo'}
                onclick={() => changeAuditionChannel('stereo')}
              >Stereo</button>
              <button
                class:active={auditionChannel === 'left'}
                type="button"
                aria-pressed={auditionChannel === 'left'}
                onclick={() => changeAuditionChannel('left')}
              >L</button>
              <button
                class:active={auditionChannel === 'right'}
                type="button"
                aria-pressed={auditionChannel === 'right'}
                onclick={() => changeAuditionChannel('right')}
              >R</button>
              <button
                class:active={auditionChannel === 'mid'}
                type="button"
                aria-pressed={auditionChannel === 'mid'}
                onclick={() => changeAuditionChannel('mid')}
              >Mid</button>
              <button
                class:active={auditionChannel === 'side'}
                type="button"
                aria-pressed={auditionChannel === 'side'}
                onclick={() => changeAuditionChannel('side')}
              >Side</button>
            </div>
          </div>
          <i class="audition-divider"></i>
          <div class="audition-group filter-group">
            <span class="audition-label">Filter</span>
            <div class="segmented filter-modes" aria-label="Audition filter">
              <button
                class:active={auditionFilter === 'off'}
                type="button"
                aria-pressed={auditionFilter === 'off'}
                onclick={() => changeAuditionFilter('off')}
              >Bypass</button>
              <button
                class:active={auditionFilter === 'highpass'}
                type="button"
                aria-pressed={auditionFilter === 'highpass'}
                onclick={() => changeAuditionFilter('highpass')}
                title="High-pass audition"
              >HP</button>
              <button
                class:active={auditionFilter === 'lowpass'}
                type="button"
                aria-pressed={auditionFilter === 'lowpass'}
                onclick={() => changeAuditionFilter('lowpass')}
                title="Low-pass audition"
              >LP</button>
            </div>
            <label class:disabled={auditionFilter === 'off'} class="filter-frequency">
              <span class="visually-hidden">Filter cutoff frequency</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={filterSliderRatio()}
                disabled={auditionFilter === 'off'}
                oninput={(event) => changeFilterFrequency(Number(event.currentTarget.value))}
              />
              <output>{auditionFilter === 'off' ? 'Bypass' : formatFrequency(currentFilterFrequency())}</output>
            </label>
          </div>
        </section>

        <Waveform
          data={decoded.waveform}
          duration={playback.duration}
          currentTime={playback.currentTime}
          {viewStart}
          {viewEnd}
          {theme}
          onSeek={(time) => void seek(time)}
          onViewChange={changeTimeView}
        />
        {#if decoded.analysis}
          <Spectrogram
            analysis={decoded.analysis}
            duration={playback.duration}
            currentTime={playback.currentTime}
            {viewStart}
            {viewEnd}
            {frequencyMin}
            {frequencyMax}
            {theme}
            onSeek={(time) => void seek(time)}
            onTimeViewChange={changeTimeView}
            onFrequencyViewChange={changeFrequencyView}
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
          sampleRate={engine?.sampleRate ?? decoded.buffer.sampleRate}
          {theme}
        />
      </div>
    {/if}
  </main>
</div>

{#if pageDragging}
  <div
    class="page-drop-overlay"
    role="presentation"
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => handlePageDrop(event, decoded ? activeSlot : 'a')}
  >
    <div class:single={!decoded} class="page-drop-targets">
      <div
        class:active={activeSlot === 'a'}
        class="page-drop-target"
        role="presentation"
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => handlePageDrop(event, 'a')}
      >
        <span class="drop-source-badge">A</span>
        <strong>{decoded ? 'Replace analysis A' : 'Analyze this file'}</strong>
        <span>{decoded ? selectedFile?.name : 'Local waveform and spectrum analysis'}</span>
      </div>
      {#if decoded}
        <div
          class:active={activeSlot === 'b'}
          class="page-drop-target"
          role="presentation"
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => handlePageDrop(event, 'b')}
        >
          <span class="drop-source-badge">B</span>
          <strong>{comparisonDecoded ? 'Replace comparison B' : 'Add comparison B'}</strong>
          <span>{comparisonFile?.name ?? 'Synchronized listening reference'}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

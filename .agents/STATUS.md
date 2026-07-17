# Project Status

Last audited: 2026-07-18

## Current Baseline

The repository now runs on SvelteKit 2, Svelte 5, Vite 8, and the Cloudflare
adapter. It can load and decode an audio file in the browser, play or seek it,
render a responsive waveform and bounded offline spectrogram, switch persisted
light and dark themes, and build the adapter-generated Worker and assets for
Cloudflare.

## Confirmed Gaps

- The offline pipeline is now sample-rate aware and maps to the source Nyquist.
- Offline analysis currently has no live frequency-response or phase scope.
- No real-time frequency-response analyzer exists.
- No phase scope, vectorscope, or correlation meter exists.
- Static visualization requires OffscreenCanvas with no main-thread fallback.
- Audio analysis returns nested JavaScript arrays with avoidable memory cost.
- The theme choice is now persisted and follows the system until changed.
- DSP tests and repeatable browser verification are still pending.

## Target State

The target is a SvelteKit audio-analysis workstation that runs fully in the
browser, deploys through Cloudflare, retains every existing workflow, and adds:

- combined stereo spectrogram
- separate left and right spectrograms
- separate Mid and Side spectrograms
- real-time log-frequency response curves
- real-time stereo phase image and correlation
- responsive, accessible light and dark themes

## Active Risks

- Large source files can make offline FFT analysis expensive. Analysis must be
  bounded by a maximum frame count and run in a Worker.
- Mid/Side values must be derived from complex L/R FFT values, not by averaging
  magnitudes after the transform.
- Browser audio starts only after a user gesture. Playback setup must remain
  lazy and recover from a suspended AudioContext.
- Canvas rendering must reserve dimensions to prevent layout shift and scale to
  device pixel ratio without multiplying CSS dimensions.

## Completed This Turn

- Replaced React, Tailwind, and Vite plugin configuration with SvelteKit.
- Added `@sveltejs/adapter-cloudflare`, JSONC Wrangler config, and generated
  Worker binding types.
- Restored file validation, drag/drop, browser decoding, play, pause, seek,
  Space and arrow keyboard controls, and waveform pointer seeking.
- Added semantic light and dark tokens with system fallback and persistence.
- Added Cloudflare dry-run evidence without external upload or storage.
- Added a typed FFT Worker with bounded frames, log-frequency bins, progress,
  cancellation, and Combined, L/R, Mid, and Side outputs.
- Added `Mix`, `L / R`, and `M / S` spectrogram views with shared seek behavior.
- Added pure DSP tests for FFT and channel separation behavior.

## Next Milestone

Connect the playback analyzer graph to live frequency-response and phase-scope
canvases, with lifecycle cleanup on pause, seek, replacement, and teardown.

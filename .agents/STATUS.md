# Project Status

Last audited: 2026-07-18

## Current Baseline

The repository runs on SvelteKit 2, Svelte 5, Vite 8, and the Cloudflare
adapter. It loads and decodes audio locally, renders an 8192-peak waveform,
chooses an adaptive high-resolution offline spectrum plan, and keeps playback
available while the typed analysis Worker runs. Worker failures now produce
structured console and copyable in-app diagnostics.

## Confirmed Limits

- Browser decoding support still determines which compressed formats can load.
- The maximum offline plan can retain about 47 MiB of spectrum output plus
  transferred channel samples in Worker memory.
- Peak hold and export are outside the current product scope.
- Rust/WASM is intentionally deferred: the optimized JavaScript DSP completes
  the 30-second maximum-plan benchmark in about 1.26 seconds on the development
  machine, while WASM would add another full-audio memory copy.

## Target State

The target is now implemented as a SvelteKit audio-analysis workstation that
runs fully in the browser, deploys through Cloudflare, retains every existing
workflow, and adds:

- combined stereo spectrogram
- separate left and right spectrograms
- separate Mid and Side spectrograms
- real-time log-frequency response curves
- real-time stereo phase image and correlation
- responsive, accessible light and dark themes

## Release Evidence

- `npm run check`: passed
- `npm run lint`: passed
- `npm run test`: passed, 17 tests
- `npm run build`: passed with Cloudflare adapter output
- `npx wrangler deploy --dry-run`: passed
- `npx wrangler types --check`: passed
- `npm audit --omit=dev`: 0 production vulnerabilities
- Playwright: desktop, tablet, and mobile light/dark screenshots passed with
  no console errors or horizontal overflow
- Playwright: a forced Worker startup failure exposed structured diagnostics,
  technical details, and a working copy action

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
- Added a typed FFT Worker with bounded frames, linear-frequency bins, progress,
  cancellation, and Combined, L/R, Mid, and Side outputs.
- Added Worker readiness, plan acknowledgement, startup/stall watchdogs,
  `onmessageerror`, result validation, stage-aware stacks, and structured logs.
- Reused FFT workspaces and precomputed transform tables, collapsed five band
  scans into one, and throttled Worker progress to percentage changes.
- Raised offline analysis to adaptive 4096/8192 FFT, 384/512 frequency bins,
  and 2400-4800 frame ceilings within explicit output-memory budgets.
- Raised waveform peaks and live analyzer FFT size to 8192, and replaced
  millions of per-cell Canvas calls with a single spectrum raster draw.
- Cached and idle-prewarmed all five spectrum channel rasters so Mix, L/R, and
  M/S switches render in roughly 8-17 ms in the desktop browser check.
- Replaced the green HSL heat map with an Audition-style dB palette progressing
  from near-black and deep blue through violet/red to orange/yellow/near-white.
- Made the spectrum height stable, extended the frequency plot to the module
  edge, moved the frequency ruler to the right, and added colored channel tags.
- Added a spectrogram-sized waiting state and copyable failure UI while keeping
  waveform, playback, and file replacement usable.
- Added `Mix`, `L / R`, and `M / S` spectrogram views with shared seek behavior.
- Added pure DSP tests for FFT and channel separation behavior.
- Added a real-time frequency-response curve with combined stereo energy and
  L/R overlays from 20 Hz to the source Nyquist.
- Added a real-time stereo phase image and correlation classification.
- Optimized live canvases to redraw only during playback and resize backing
  stores only when the viewport changes.
- Verified the complete flow in a real browser with a 48 kHz stereo fixture.

## Next Milestone

Collect production-device timings before considering a Rust/WASM backend. A
WASM implementation should be accepted only if end-to-end analysis improves
materially after its extra input copy and module startup cost are included.

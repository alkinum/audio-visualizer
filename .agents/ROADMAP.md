# Roadmap

## Milestone 1: Platform Migration - Complete

Deliverables:

- SvelteKit 2 and Svelte 5 application shell
- Cloudflare adapter and Wrangler configuration
- browser-only audio workspace with SSR-safe initialization
- retained drag/drop, decode, play, pause, seek, and keyboard controls
- retained waveform with combined and split-channel display

Acceptance gate:

- `npm run check`, `npm run lint`, and `npm run build` pass
- `wrangler deploy --dry-run` reads the generated Worker and assets
- `wrangler types --check` confirms the generated binding types

## Milestone 2: Offline Spectral Analysis - Complete

Deliverables:

- typed FFT Worker with Hann windowing
- sample-rate-aware 0 Hz to Nyquist mapping
- bounded linear-frequency bins and bounded time frames
- combined, L/R, and Mid/Side display modes
- progressive analysis status and cancellation when a file is replaced

Acceptance gate:

- DSP unit tests cover FFT peak location and Mid/Side channel math
- a stereo fixture visibly separates channel-specific content

Evidence: `src/lib/audio/dsp.test.ts` covers FFT location, bounded frames,
in-phase Mid dominance, and polarity-inverted Side dominance. The Svelte page
renders the three display modes from Worker output.

## Milestone 3: Real-Time Analysis - Complete

Deliverables:

- Web Audio analyzer graph for L, R, Mid, and Side
- real-time frequency-response canvas with smoothing and peak hold
- real-time phase image with correlation value
- clean lifecycle on pause, seek, file replacement, and component teardown

Acceptance gate:

- analyzers update only while playing
- no duplicate audible routing or gain change is introduced

Evidence: `LiveRack.svelte` owns one animation loop for both canvases and stops
redrawing when paused. Browser playback of a 440 Hz left and 880 Hz right
fixture produced two response peaks, a non-empty phase image, and correlation.

## Milestone 4: Product UI - Complete

Deliverables:

- professional audio-workstation hierarchy
- semantic light and dark color tokens with persisted mode
- desktop cockpit layout and explicit tablet/mobile collapse
- loading, empty, ready, playback, analysis, and error states
- complete keyboard and pointer interaction

Acceptance gate:

- desktop and mobile screenshots pass visual review in both themes
- no overlap, clipped labels, unstable canvas sizing, or inaccessible controls

Evidence: Playwright screenshots cover 1440 x 1000 light and dark, 768 x 1024
light, and 390 x 844 dark. The browser reports no horizontal overflow and all
four canvas backing stores have stable dimensions.

## Milestone 5: Release Hardening - Complete

Deliverables:

- README aligned with SvelteKit and Cloudflare workflow
- completed verification record
- final status and known-limitations audit
- rolling commits following `type:   description`

Acceptance gate:

- all requirements have direct file, test, build, or browser evidence

Evidence: README, verification matrix, Cloudflare dry-run, generated type check,
the passing DSP and metering suite, and the rolling commit history are in
place. A production publish was intentionally not run because no deployment
authorization or target account was provided.

## Milestone 6: Analysis Reliability and Resolution - Complete

Deliverables:

- adaptive offline plans with 4096/8192 FFT, 384/512 bins, and bounded memory
- reusable FFT workspaces and one-pass Mix/L/R/M/S frequency aggregation
- typed Worker ready, plan, progress, result, and structured-error messages
- startup and stall watchdogs plus message and result validation
- stable long-analysis status and copyable technical failure details
- 8192-point waveform peaks and live analyzer FFT

Acceptance gate:

- a real 30-second WAV completes the maximum plan with a non-empty spectrum
- a forced Worker startup failure includes stage, stack, input, plan, runtime,
  elapsed time, and a working copy action
- desktop and 390 px mobile layouts have no horizontal overflow

Evidence: 17 unit tests pass, a maximum-plan 30-second DSP benchmark completes
in about 1.26 seconds on the development machine, and Playwright verifies the
normal, pending, failure, copy, playback, and mobile flows.

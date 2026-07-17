# Project Status

Last audited: 2026-07-18

## Current Baseline

The repository is a React 18 and Vite single-page application. It can load an
audio file, decode it in the browser, play or seek it, render a static waveform,
render a mixed-channel spectrogram, switch light and dark themes, and deploy a
static `dist` directory to Cloudflare Pages.

## Confirmed Gaps

- SvelteKit migration has not started.
- The spectrogram merges all channels and cannot display L/R or Mid/Side.
- Its renderer assumes a 44.1 kHz source and labels only up to 16 kHz.
- No real-time frequency-response analyzer exists.
- No phase scope, vectorscope, or correlation meter exists.
- Static visualization requires OffscreenCanvas with no main-thread fallback.
- Audio analysis returns nested JavaScript arrays with avoidable memory cost.
- Theme choice follows the system only and is not persisted.
- There is no test suite or repeatable browser verification workflow.

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

## Next Milestone

Replace the React shell with SvelteKit, configure the Cloudflare adapter, and
restore file loading, playback, seeking, and waveform rendering before adding
new analyzer modes.

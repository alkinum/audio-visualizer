# Module Architecture

## Runtime Boundaries

```text
SvelteKit route
  -> workspace state and lifecycle
  -> file decoder
  -> offline analysis Worker
  -> playback engine and Web Audio graph
  -> canvas visualization components
```

The route is server-renderable as an empty application shell. Browser APIs are
created only after mount or after a user action.

## Implemented Modules

### `src/lib/audio/types.ts`

Owns shared audio, analysis, playback, theme, and visualization types. Worker
messages use discriminated unions from this module where possible.

### `src/lib/audio/decode.ts`

Decodes a `File` into an `AudioBuffer`, derives bounded waveform peaks, and
starts offline spectral analysis. It owns no UI state.

### `src/lib/audio/playback.ts`

Owns `AudioContext`, source-node recreation, pause offsets, seeking, end events,
output routing, and the live analyzer graph. Each playback start creates one
new `AudioBufferSourceNode`, because source nodes cannot be restarted.

### `src/lib/audio/analysis.worker.ts`

Runs the offline FFT pipeline. It transfers typed-array results back to the
main thread and reports progress. It never reads DOM or Svelte state.

### `src/lib/audio/dsp.ts`

Contains pure FFT, windowing, frequency mapping, and Mid/Side math that can run
in tests and in the Worker.

### `src/lib/components/*`

Svelte components own presentation and pointer interaction. Canvas components
observe their container, apply device-pixel-ratio scaling, and draw from typed
data without pushing per-frame values through the Svelte render tree.

## Offline Spectral Model

For every selected time frame:

1. Apply a Hann window to L and R sample windows.
2. Run a complex FFT for L and R.
3. Derive Mid as `(L + R) / sqrt(2)` and Side as `(L - R) / sqrt(2)` in the
   complex frequency domain.
4. Derive combined stereo energy as the RMS of L and R magnitudes.
5. Aggregate FFT bins into a fixed logarithmic frequency grid.
6. Convert magnitudes to dBFS and clamp to the configured display floor.

Frame count and frequency-bin count are bounded independently of file duration,
which keeps Worker output predictable for long files.

## Real-Time Audio Graph

```text
AudioBufferSource
  -> channel splitter
     -> L analyzer
     -> R analyzer
     -> Mid sum -> Mid analyzer
     -> Side difference -> Side analyzer
  -> output gain -> destination
```

Analyzer branches feed a zero-gain sink so they remain part of the rendered
graph without contributing duplicate audio. Playback audio uses one direct
route to the output gain.

## Deployment

SvelteKit uses `@sveltejs/adapter-cloudflare`. The generated Worker and static
assets are deployed by Wrangler. Audio files never leave the browser and no
storage binding or server upload endpoint is required.

# Verification Matrix

## Automated Gates

```bash
npm run check
npm run lint
npm run test
npm run build
```

## DSP Evidence

- sine-wave FFT peak lands in the expected FFT region
- identical L/R input produces Mid energy and a suppressed Side result
- polarity-inverted L/R input produces Side energy and a suppressed Mid result
- sample-rate-specific Nyquist values cap labels and bins correctly
- every perceptual-log band remains non-empty from DC through Nyquist
- a DC signal lands in the bottom spectrum band
- the 0 Hz-anchored scale round-trips frequencies and allocates over 20x more
  display space to 0-1 kHz than to an equal-width interval around 10 kHz
- optimized FFT output matches a direct Fourier transform
- adaptive plans respect constrained and maximum output-memory budgets
- Error and non-Error failures retain structured diagnostic context

Automated evidence: `npm run test` passes 20 DSP, planning, diagnostics,
palette, and metering tests.

## Browser Flows

- load a stereo WAV through the picker and through drag/drop
- reject a non-audio file with an inline message
- play, pause, seek, restart, and reach natural playback end
- use Space and Left/Right arrow keyboard controls outside editable fields
- switch combined, L/R, and M/S spectrogram views
- observe live response, phase image, and correlation during playback
- replacing a file cancels the prior Worker and prevents stale results from
  replacing the new session

Verified on 2026-07-18 with generated 48 kHz stereo WAV fixtures:

- file upload, offline analysis, waveform, and seek surfaces rendered
- `Mix`, `L / R`, and `M / S` buttons entered their active states
- playback produced non-empty response and phase canvases
- live response showed separate 440 Hz and 880 Hz peaks
- favicon and application resources loaded with zero console errors
- replacing a 30 second fixture with the short fixture left only the short
  file selected and its fresh analysis visible
- maximum-plan 30-second DSP benchmark: 4096 FFT, 512 bins, 4787 frames,
  46.7 MiB output, about 1.26 seconds on the development machine
- forced Worker startup timeout rendered a detailed failure panel and logged a
  structured `worker-startup-timeout` object
- technical details included stack, stage, 48 kHz/2-channel input, plan,
  capability hints, elapsed time, and user agent; copy changed to `Copied`
- normal short-WAV analysis and 8192 FFT playback completed with zero browser
  console errors or warnings
- cached desktop spectrum switches completed in 11.8-16.8 ms after warm-up;
  the first cold GPU composite reached 90.7 ms
- desktop and 390 px mobile spectrum sections reported a 1 px bottom gap,
  exactly matching the module divider, with no horizontal overflow
- full-page and mobile screenshots confirmed right-side 0 Hz-to-Nyquist
  labels, unobscured L/R/M/S tags, and the Audition-style intensity palette
- the latest full-page check confirmed expanded 0-1 kHz spacing, compressed
  10-24 kHz spacing, and visible low-level detail around 440/880 Hz tones

## Visual Matrix

- 1440 x 1000 light
- 1440 x 1000 dark
- 768 x 1024 light
- 390 x 844 dark

Check text fit, control wrapping, canvas visibility, theme contrast, focus rings,
and the absence of unintended horizontal scrolling in every viewport.

Screenshot evidence exists for all four target viewports and themes listed
above. The browser reported no horizontal overflow and no console errors.

The new analysis states were additionally inspected at desktop width and at
390 x 844. The mobile document width remained exactly 390 px, and sampled
pixels from waveform, spectrum, response, and phase canvases were non-empty.

## Cloudflare Gate

- build output contains the adapter-generated Worker and static assets
- Wrangler configuration validates against its installed schema
- no secret, storage, or upload binding is present
- audio remains local to the browser

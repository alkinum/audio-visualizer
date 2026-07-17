# Verification Matrix

## Automated Gates

```bash
npm run check
npm run lint
npm run test
npm run build
```

## DSP Evidence

- sine-wave FFT peak lands in the expected log-frequency region
- identical L/R input produces Mid energy and a suppressed Side result
- polarity-inverted L/R input produces Side energy and a suppressed Mid result
- sample-rate-specific Nyquist values cap labels and bins correctly

Automated evidence: `npm run test` passes four DSP tests covering the first four
checks above. Browser fixture verification remains in the release milestone.

## Browser Flows

- load a stereo WAV through the picker and through drag/drop
- reject a non-audio file with an inline message
- play, pause, seek, restart, and reach natural playback end
- use Space and Left/Right arrow keyboard controls outside editable fields
- switch combined, L/R, and M/S spectrogram views
- observe live response, phase image, and correlation during playback
- replace a file while analysis is running without stale results appearing

## Visual Matrix

- 1440 x 1000 light
- 1440 x 1000 dark
- 768 x 1024 light
- 390 x 844 dark

Check text fit, control wrapping, canvas visibility, theme contrast, focus rings,
and the absence of unintended horizontal scrolling in every viewport.

## Cloudflare Gate

- build output contains the adapter-generated Worker and static assets
- Wrangler configuration validates against its installed schema
- no secret, storage, or upload binding is present
- audio remains local to the browser

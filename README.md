# Audio Visualizer

Audio Visualizer is a browser-local stereo analysis workstation. Audio files
are decoded and analyzed on the device. No upload endpoint, account, or
storage binding is required.

## Current Features

- drag and drop or file-picker loading for common browser-decodable audio
- waveform overview with combined and split L/R views
- keyboard transport: Space toggles playback, arrow keys seek five seconds
- adaptive high-resolution perceptual-log spectrogram anchored from 0 Hz to source Nyquist
- Combined stereo, Left / Right, and Mid / Side spectrogram views
- stable long-analysis status with plan, elapsed time, and progress details
- structured Worker diagnostics with copyable failure context
- real-time combined frequency response with L/R traces
- real-time stereo phase image and correlation classification
- persisted light and dark themes
- responsive desktop, tablet, and mobile workspace layouts

## Stack

- SvelteKit 2 and Svelte 5
- Vite 8 and TypeScript
- Web Audio API and a typed analysis Web Worker
- native CSS tokens and canvas rendering
- Cloudflare Workers through `@sveltejs/adapter-cloudflare`

## Local Development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

The Vite server prints the local URL. Audio processing stays in the browser.

## Verification Commands

```bash
npm run check
npm run lint
npm run test
npm run build
npx wrangler types --check
npx wrangler deploy --dry-run
```

`npm run test` covers FFT numerical parity and peak location, adaptive and
bounded frame planning, log-band safety, diagnostics serialization, Mid / Side
separation, RMS dB combination, and phase correlation math.

## Cloudflare Deployment

The repository uses a Worker deployment rather than the legacy Pages directory
upload. Authenticate Wrangler once with `npx wrangler login`, then run:

```bash
npm run deploy
```

The generated Worker entry is `.svelte-kit/cloudflare/_worker.js` and assets
are served from `.svelte-kit/cloudflare`. Use `npx wrangler deploy --dry-run`
to validate the bundle without publishing it.

## Project Documents

The durable project plan lives in [`.agents/`](.agents/):

- [`STATUS.md`](.agents/STATUS.md): implementation state and evidence
- [`ROADMAP.md`](.agents/ROADMAP.md): milestones and acceptance gates
- [`ARCHITECTURE.md`](.agents/ARCHITECTURE.md): DSP and runtime boundaries
- [`DESIGN.md`](.agents/DESIGN.md): UI tokens and interaction rules
- [`VERIFICATION.md`](.agents/VERIFICATION.md): automated and browser checks

## License

MIT

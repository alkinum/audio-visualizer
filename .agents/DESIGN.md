# Product Design Specification

## Design Read

This is a redesign-overhaul of a technical audio-analysis workstation for
mixing and mastering users. The interface should feel like modern measurement
hardware and a restrained DAW, not a marketing page.

Taste parameters:

- `DESIGN_VARIANCE: 5`
- `MOTION_INTENSITY: 4`
- `VISUAL_DENSITY: 8`

## Visual Language

- Cool neutral surfaces in both themes
- One cyan-green accent for active and live states
- Warm red reserved for clipping, errors, and the playhead
- Monospace numerals for time, frequency, dB, sample rate, and correlation
- One-pixel dividers instead of stacked cards
- Eight-pixel panel radius and six-pixel control radius
- No gradients, glow effects, decorative glass, or oversized headings
- Spectrum intensity uses a data-encoding palette modeled on Audition: low dB
  near-black/blue, then violet/red, orange/yellow, and near-white at peaks
- Spectrum color sensitivity spans -120 to 0 dBFS and lifts low-level detail
  without changing the near-black analysis floor
- L/R and M/S use distinct colored mode marks and bordered in-chart channel
  tags; the same channel colors remain stable in both themes

## Information Architecture

Desktop workspace:

```text
top bar: product, file identity, theme, source link
transport: play, time, scrubber, file action, technical metadata
waveform: overview and seek surface
spectral workspace: spectrogram plus display-mode controls
live rack: frequency response plus phase scope and correlation
```

Tablet and mobile:

- Top bar wraps only below 640 px and keeps actions on one row.
- Transport metadata moves below the scrubber.
- The live rack becomes one column.
- Spectrogram L/R and M/S panes remain stacked, never squeezed side by side.
- The spectral plot uses a stable 430 px height across all channel modes and
  reaches the module divider without an artificial low-frequency footer.
- Its Y axis uses a 0 Hz-anchored perceptual log curve so bass receives more
  vertical space while high frequencies remain compact.
- Every canvas has a stable minimum height and a bounded aspect ratio.

## Theme Tokens

Themes use semantic CSS variables at the document root. A stored user choice
overrides the system preference. `auto` continues to follow system changes.

Required token groups:

- canvas and surface backgrounds
- strong, muted, and faint text
- dividers and control borders
- accent, accent contrast, danger, and warning
- chart grid, chart text, playhead, L, R, Mid, and Side traces

Channel trace colors are data-encoding colors, not competing brand accents.

## Interaction States

- Empty: compact file drop target fills the primary work area.
- Dragging: target border and background change without layout movement.
- Loading: stage label, progress value, and stable placeholder canvases.
- Ready: all file metadata and analyzers become available.
- Playing: transport and live rack update at animation-frame cadence.
- Paused: static views remain visible; live scopes hold their last frame.
- Error: contextual message stays beside the file action.

## Motion Rules

Motion communicates state only: panel entry after decode, button press feedback,
and chart updates driven by audio. All decorative animation is excluded. CSS
transitions honor `prefers-reduced-motion`.

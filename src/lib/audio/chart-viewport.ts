export interface AxisRange {
  start: number;
  end: number;
}

export function clampAxisRange(
  range: AxisRange,
  minimum: number,
  maximum: number,
  minimumSpan = 0,
): AxisRange {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    throw new RangeError('Axis bounds must define a positive span');
  }

  const boundedMinimumSpan = Math.max(0, Math.min(maximum - minimum, minimumSpan));
  const requestedSpan = Math.max(boundedMinimumSpan, Math.min(maximum - minimum, range.end - range.start));
  let start = Math.max(minimum, Math.min(maximum - requestedSpan, range.start));
  let end = start + requestedSpan;

  if (end > maximum) {
    end = maximum;
    start = maximum - requestedSpan;
  }

  return { start, end };
}

export function zoomAxisRange(
  range: AxisRange,
  factor: number,
  anchor: number,
  minimum: number,
  maximum: number,
  minimumSpan = 0,
): AxisRange {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Zoom factor must be positive');

  const current = clampAxisRange(range, minimum, maximum, minimumSpan);
  const currentSpan = current.end - current.start;
  const nextSpan = Math.max(minimumSpan, Math.min(maximum - minimum, currentSpan * factor));
  const boundedAnchor = Math.max(current.start, Math.min(current.end, anchor));
  const anchorRatio = currentSpan > 0 ? (boundedAnchor - current.start) / currentSpan : 0.5;

  return clampAxisRange(
    {
      start: boundedAnchor - nextSpan * anchorRatio,
      end: boundedAnchor + nextSpan * (1 - anchorRatio),
    },
    minimum,
    maximum,
    minimumSpan,
  );
}

export function panAxisRange(
  range: AxisRange,
  delta: number,
  minimum: number,
  maximum: number,
  minimumSpan = 0,
): AxisRange {
  return clampAxisRange(
    { start: range.start + delta, end: range.end + delta },
    minimum,
    maximum,
    minimumSpan,
  );
}

export const SPECTRUM_FREQUENCY_LABEL_HEIGHT = 9;

export interface SpectrumFrequencyTickLayout {
  frequency: number;
  ratio: number;
  lineY: number;
  labelY: number;
  labelBaseline: 'top' | 'middle' | 'bottom';
  showLabel: boolean;
}

interface LabelBounds {
  top: number;
  bottom: number;
}

const labelEdgeInset = 7;
const labelGap = 2;

export function layoutSpectrumFrequencyTicks(
  frequencies: readonly number[],
  frequencyRatio: (frequency: number) => number,
  top: number,
  panelHeight: number,
): SpectrumFrequencyTickLayout[] {
  if (frequencies.length === 0) return [];

  const bounds: LabelBounds[] = [];
  const layouts = frequencies.map((frequency) => {
    const ratio = Math.max(0, Math.min(1, frequencyRatio(frequency)));
    const rawY = top + panelHeight - ratio * panelHeight;
    const lineY = Math.max(top + 0.5, Math.min(top + panelHeight - 0.5, rawY));
    const labelBaseline = ratio > 0.98 ? 'top' : ratio < 0.02 ? 'bottom' : 'middle';
    const labelY = ratio > 0.98 ? top + labelEdgeInset : ratio < 0.02 ? top + panelHeight - labelEdgeInset : rawY;
    const labelTop = labelBaseline === 'top'
      ? labelY
      : labelBaseline === 'bottom'
        ? labelY - SPECTRUM_FREQUENCY_LABEL_HEIGHT
        : labelY - SPECTRUM_FREQUENCY_LABEL_HEIGHT / 2;
    bounds.push({ top: labelTop, bottom: labelTop + SPECTRUM_FREQUENCY_LABEL_HEIGHT });

    return {
      frequency,
      ratio,
      lineY,
      labelY,
      labelBaseline,
      showLabel: false,
    } satisfies SpectrumFrequencyTickLayout;
  });

  const selected = new Set<number>([0, layouts.length - 1]);
  const selectedBounds = [bounds[0], bounds.at(-1)!];
  for (let index = 1; index < layouts.length - 1; index += 1) {
    const candidate = bounds[index];
    const overlaps = selectedBounds.some(
      (accepted) => candidate.top < accepted.bottom + labelGap && candidate.bottom + labelGap > accepted.top,
    );
    if (!overlaps) {
      selected.add(index);
      selectedBounds.push(candidate);
    }
  }

  return layouts.map((layout, index) => ({ ...layout, showLabel: selected.has(index) }));
}

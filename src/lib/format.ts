export function formatTime(seconds: number, includeMilliseconds = false): string {
  if (!Number.isFinite(seconds)) return includeMilliseconds ? '00:00.000' : '00:00';

  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);

  if (!includeMilliseconds) {
    return `${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}`;
  }

  const milliseconds = Math.floor((safeSeconds % 1) * 1000);
  return `${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatFrequency(sampleRate: number): string {
  if (sampleRate >= 1000) return `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz`;
  return `${sampleRate} Hz`;
}

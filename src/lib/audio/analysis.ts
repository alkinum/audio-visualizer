import type { AnalysisProgress, OfflineAnalysis } from './types';

interface WorkerResult {
  type: 'result';
  analysis: {
    channels: Record<'combined' | 'left' | 'right' | 'mid' | 'side', ArrayBuffer>;
    frameCount: number;
    binCount: number;
    duration: number;
    sampleRate: number;
    minDb: number;
    maxDb: number;
  };
}

interface WorkerProgress {
  type: 'progress';
  frame: number;
  totalFrames: number;
}

interface WorkerError {
  type: 'error';
  error: string;
}

export interface AnalysisTask {
  promise: Promise<OfflineAnalysis>;
  cancel: () => void;
}

export function analyzeAudioBuffer(
  buffer: AudioBuffer,
  onProgress?: (progress: AnalysisProgress) => void,
): AnalysisTask {
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectPromise: (reason?: unknown) => void = () => undefined;

  const promise = new Promise<OfflineAnalysis>((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event: MessageEvent<WorkerResult | WorkerProgress | WorkerError>) => {
      if (event.data.type === 'progress') {
        onProgress?.({
          progress: Math.round((event.data.frame / event.data.totalFrames) * 100),
          frame: event.data.frame,
          totalFrames: event.data.totalFrames,
        });
        return;
      }

      if (event.data.type === 'error') {
        settled = true;
        worker.terminate();
        reject(new Error(event.data.error));
        return;
      }

      settled = true;
      worker.terminate();
      const payload = event.data.analysis;
      resolve({
        ...payload,
        channels: {
          combined: new Float32Array(payload.channels.combined),
          left: new Float32Array(payload.channels.left),
          right: new Float32Array(payload.channels.right),
          mid: new Float32Array(payload.channels.mid),
          side: new Float32Array(payload.channels.side),
        },
      });
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(event.error ?? new Error('Audio analysis worker failed'));
    };

    const left = buffer.getChannelData(0).slice();
    const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
    worker.postMessage(
      {
        type: 'analyze',
        left,
        right,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
      },
      [left.buffer, right.buffer],
    );
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectPromise(new DOMException('Audio analysis cancelled', 'AbortError'));
    },
  };
}

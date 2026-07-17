/// <reference lib="webworker" />

import { analyzeStereo } from './dsp';

interface AnalyzeMessage {
  type: 'analyze';
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  duration: number;
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data.type !== 'analyze') return;

  try {
    const analysis = analyzeStereo(event.data.left, event.data.right, event.data.sampleRate, event.data.duration, {
      onProgress: (frame, totalFrames) => {
        workerScope.postMessage({ type: 'progress', frame, totalFrames });
      },
    });

    const channels = analysis.channels;
    workerScope.postMessage(
      {
        type: 'result',
        analysis: {
          ...analysis,
          channels: {
            combined: channels.combined.buffer,
            left: channels.left.buffer,
            right: channels.right.buffer,
            mid: channels.mid.buffer,
            side: channels.side.buffer,
          },
        },
      },
      [channels.combined.buffer, channels.left.buffer, channels.right.buffer, channels.mid.buffer, channels.side.buffer],
    );
  } catch (cause) {
    workerScope.postMessage({
      type: 'error',
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

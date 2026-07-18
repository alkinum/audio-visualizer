/// <reference lib="webworker" />

import type { AnalysisWorkerRequest, AnalysisWorkerMessage } from './analysis-protocol';
import { serializeAnalysisError } from './analysis-protocol';
import { analyzeStereo } from './dsp';
import type { AnalysisStage } from './types';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  if (event.data.type !== 'analyze') return;

  const request = event.data;
  let stage: AnalysisStage = 'analyzing';

  try {
    postMessage({ type: 'plan', requestId: request.requestId, plan: request.plan });
    postProgress(request.requestId, 'analyzing', 0, request.plan.frameCount);
    let lastPercent = -1;
    const analysis = analyzeStereo(request.left, request.right, request.sampleRate, request.duration, {
      fftSize: request.plan.fftSize,
      binCount: request.plan.binCount,
      maxFrames: request.plan.maxFrames,
      onProgress: (frame, totalFrames) => {
        const percent = Math.floor((frame / Math.max(1, totalFrames)) * 100);
        if (percent === lastPercent && frame < totalFrames) return;
        lastPercent = percent;
        postProgress(request.requestId, 'analyzing', frame, totalFrames);
      },
    });

    if (analysis.frameCount !== request.plan.frameCount) {
      throw new Error(
        `Analysis plan mismatch: expected ${request.plan.frameCount} frames, received ${analysis.frameCount}`,
      );
    }

    stage = 'finalizing';
    postProgress(request.requestId, 'finalizing', analysis.frameCount, analysis.frameCount);
    const channels = analysis.channels;
    const message: AnalysisWorkerMessage = {
      type: 'result',
      requestId: request.requestId,
      analysis: {
        ...analysis,
        channels: {
          combined: channels.combined.buffer as ArrayBuffer,
          left: channels.left.buffer as ArrayBuffer,
          right: channels.right.buffer as ArrayBuffer,
          mid: channels.mid.buffer as ArrayBuffer,
          side: channels.side.buffer as ArrayBuffer,
        },
      },
    };
    workerScope.postMessage(message, [
      channels.combined.buffer,
      channels.left.buffer,
      channels.right.buffer,
      channels.mid.buffer,
      channels.side.buffer,
    ]);
  } catch (cause) {
    postMessage({
      type: 'error',
      requestId: request.requestId,
      error: serializeAnalysisError(cause, stage, {
        sampleRate: request.sampleRate,
        duration: request.duration,
        leftSamples: request.left.length,
        rightSamples: request.right.length,
        fftSize: request.plan.fftSize,
        binCount: request.plan.binCount,
        frameCount: request.plan.frameCount,
      }),
    });
  }
};

workerScope.onmessageerror = () => {
  postMessage({
    type: 'error',
    error: serializeAnalysisError(
      new DOMException('The analysis request could not be deserialized by the Worker', 'DataCloneError'),
      'transferring',
    ),
  });
};

postMessage({ type: 'ready' });

function postProgress(
  requestId: string,
  stage: 'analyzing' | 'finalizing',
  frame: number,
  totalFrames: number,
): void {
  const message: AnalysisWorkerMessage = { type: 'progress', requestId, stage, frame, totalFrames };
  workerScope.postMessage(message);
}

function postMessage(message: AnalysisWorkerMessage): void {
  workerScope.postMessage(message);
}

import { createAnalysisPlan, getAnalysisCapabilities } from './analysis-plan';
import type {
  AnalysisWorkerMessage,
  AnalyzeWorkerRequest,
  SerializedAnalysisError,
  WorkerResultMessage,
} from './analysis-protocol';
import { serializeAnalysisError } from './analysis-protocol';
import type {
  AnalysisCapabilities,
  AnalysisPlan,
  AnalysisProgress,
  AnalysisStage,
  OfflineAnalysis,
} from './types';

const WORKER_STARTUP_TIMEOUT_MS = 10_000;
const WORKER_STALL_TIMEOUT_MS = 45_000;

export type AudioAnalysisFailureCode =
  | 'worker-construction'
  | 'worker-startup-timeout'
  | 'worker-runtime'
  | 'worker-stalled'
  | 'request-transfer'
  | 'message-deserialization'
  | 'worker-reported'
  | 'invalid-result';

export interface AnalysisSourceMetadata {
  name?: string;
  size?: number;
  type?: string;
  lastModified?: number;
}

export interface AudioAnalysisDiagnostics {
  schemaVersion: 1;
  code: AudioAnalysisFailureCode;
  requestId: string;
  occurredAt: string;
  elapsedMs: number;
  stage: AnalysisStage;
  error: SerializedAnalysisError;
  input: {
    sampleRate: number;
    duration: number;
    numberOfChannels: number;
    sampleLength: number;
  };
  source?: AnalysisSourceMetadata;
  plan: AnalysisPlan;
  capabilities: AnalysisCapabilities;
  worker?: {
    message?: string;
    filename?: string;
    line?: number;
    column?: number;
  };
  userAgent?: string;
}

export class AudioAnalysisError extends Error {
  readonly code: AudioAnalysisFailureCode;
  readonly diagnostics: AudioAnalysisDiagnostics;

  constructor(message: string, diagnostics: AudioAnalysisDiagnostics, cause?: unknown) {
    super(message, { cause });
    this.name = 'AudioAnalysisError';
    this.code = diagnostics.code;
    this.diagnostics = diagnostics;
  }
}

export interface AnalysisTask {
  promise: Promise<OfflineAnalysis>;
  cancel: () => void;
  plan: AnalysisPlan;
  startedAt: number;
}

export function analyzeAudioBuffer(
  buffer: AudioBuffer,
  onProgress?: (progress: AnalysisProgress) => void,
  source?: AnalysisSourceMetadata,
): AnalysisTask {
  const capabilities = getAnalysisCapabilities();
  const plan = createAnalysisPlan(
    { sampleLength: buffer.length, sampleRate: buffer.sampleRate, duration: buffer.duration },
    capabilities,
  );
  const requestId = createRequestId();
  const startedAt = performance.now();
  let worker: Worker;

  try {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  } catch (cause) {
    const error = makeAnalysisError(
      'worker-construction',
      'starting',
      cause,
      makeDiagnosticContext(buffer, source, plan, capabilities, requestId, startedAt),
    );
    reportAnalysisFailure(error);
    throw error;
  }

  let settled = false;
  let currentStage: AnalysisStage = 'starting';
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;

  const promise = new Promise<OfflineAnalysis>((resolve, reject) => {
    rejectPromise = reject;

    const finishFailure = (
      code: AudioAnalysisFailureCode,
      stage: AnalysisStage,
      cause: unknown,
      workerDetails?: AudioAnalysisDiagnostics['worker'],
      remoteError?: SerializedAnalysisError,
    ): void => {
      if (settled) return;
      settled = true;
      const error = makeAnalysisError(
        code,
        stage,
        cause,
        makeDiagnosticContext(buffer, source, plan, capabilities, requestId, startedAt),
        workerDetails,
        remoteError,
      );
      cleanup();
      reportAnalysisFailure(error);
      reject(error);
    };

    const emitProgress = (stage: AnalysisStage, frame: number, totalFrames: number): void => {
      currentStage = stage;
      const progress = stage === 'finalizing' ? 100 : Math.round((frame / Math.max(1, totalFrames)) * 100);
      onProgress?.({
        stage,
        progress: Math.max(0, Math.min(100, progress)),
        frame,
        totalFrames,
        elapsedMs: performance.now() - startedAt,
      });
    };

    const resetStallTimer = (): void => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        finishFailure(
          'worker-stalled',
          currentStage,
          new Error(`Analysis Worker produced no messages for ${WORKER_STALL_TIMEOUT_MS / 1000} seconds`),
        );
      }, WORKER_STALL_TIMEOUT_MS);
    };

    const sendRequest = (): void => {
      emitProgress('transferring', 0, plan.frameCount);
      currentStage = 'transferring';

      try {
        const left = buffer.getChannelData(0).slice();
        const rightSource = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
        const right = rightSource.slice();
        const request: AnalyzeWorkerRequest = {
          type: 'analyze',
          requestId,
          left,
          right,
          sampleRate: buffer.sampleRate,
          duration: buffer.duration,
          plan,
        };
        worker.postMessage(request, [left.buffer, right.buffer]);
        resetStallTimer();
      } catch (cause) {
        finishFailure('request-transfer', 'transferring', cause);
      }
    };

    worker.onmessage = (event: MessageEvent<AnalysisWorkerMessage>) => {
      if (settled) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || !('type' in message)) {
        finishFailure('message-deserialization', currentStage, new TypeError('Worker returned an invalid message'));
        return;
      }

      if (message.type === 'ready') {
        if (startupTimer) clearTimeout(startupTimer);
        sendRequest();
        return;
      }

      if ('requestId' in message && message.requestId && message.requestId !== requestId) return;
      resetStallTimer();

      if (message.type === 'plan') {
        if (!plansMatch(plan, message.plan)) {
          finishFailure('invalid-result', currentStage, new Error('Worker acknowledged a different analysis plan'));
        }
        return;
      }

      if (message.type === 'progress') {
        emitProgress(message.stage, message.frame, message.totalFrames);
        return;
      }

      if (message.type === 'error') {
        finishFailure('worker-reported', message.error.stage, message.error.message, undefined, message.error);
        return;
      }

      try {
        const analysis = deserializeAnalysis(message, plan);
        settled = true;
        cleanup();
        resolve(analysis);
      } catch (cause) {
        finishFailure('invalid-result', 'finalizing', cause);
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      finishFailure(
        'worker-runtime',
        currentStage,
        event.error ?? new Error(event.message || 'Audio analysis Worker failed'),
        {
          message: event.message || undefined,
          filename: event.filename || undefined,
          line: event.lineno || undefined,
          column: event.colno || undefined,
        },
      );
    };

    worker.onmessageerror = () => {
      finishFailure(
        'message-deserialization',
        currentStage,
        new DOMException('The browser could not deserialize a message from the analysis Worker', 'DataCloneError'),
      );
    };

    startupTimer = setTimeout(() => {
      finishFailure(
        'worker-startup-timeout',
        'starting',
        new Error(`Analysis Worker did not become ready within ${WORKER_STARTUP_TIMEOUT_MS / 1000} seconds`),
      );
    }, WORKER_STARTUP_TIMEOUT_MS);
    emitProgress('starting', 0, plan.frameCount);
  });

  function cleanup(): void {
    if (startupTimer) clearTimeout(startupTimer);
    if (stallTimer) clearTimeout(stallTimer);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  return {
    promise,
    plan,
    startedAt,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new DOMException('Audio analysis cancelled', 'AbortError'));
    },
  };
}

export function formatAudioAnalysisDiagnostics(error: AudioAnalysisError): string {
  return JSON.stringify(
    {
      name: error.name,
      message: error.message,
      ...error.diagnostics,
    },
    null,
    2,
  );
}

function deserializeAnalysis(message: WorkerResultMessage, plan: AnalysisPlan): OfflineAnalysis {
  const payload = message.analysis;
  if (
    !Number.isInteger(payload.frameCount) ||
    payload.frameCount < 1 ||
    payload.frameCount !== plan.frameCount ||
    !Number.isInteger(payload.binCount) ||
    payload.binCount !== plan.binCount
  ) {
    throw new TypeError('Worker result dimensions do not match the analysis plan');
  }

  const expectedBytes = payload.frameCount * payload.binCount * Float32Array.BYTES_PER_ELEMENT;
  const channelNames = ['combined', 'left', 'right', 'mid', 'side'] as const;
  for (const channel of channelNames) {
    if (!(payload.channels[channel] instanceof ArrayBuffer) || payload.channels[channel].byteLength !== expectedBytes) {
      throw new TypeError(`Worker result for ${channel} has an invalid byte length`);
    }
  }

  if (
    !Number.isFinite(payload.duration) ||
    !Number.isFinite(payload.sampleRate) ||
    !Number.isFinite(payload.minDb) ||
    !Number.isFinite(payload.maxDb)
  ) {
    throw new TypeError('Worker result metadata is invalid');
  }

  return {
    ...payload,
    channels: {
      combined: new Float32Array(payload.channels.combined),
      left: new Float32Array(payload.channels.left),
      right: new Float32Array(payload.channels.right),
      mid: new Float32Array(payload.channels.mid),
      side: new Float32Array(payload.channels.side),
    },
  };
}

function plansMatch(expected: AnalysisPlan, received: AnalysisPlan): boolean {
  return (
    received.fftSize === expected.fftSize &&
    received.binCount === expected.binCount &&
    received.maxFrames === expected.maxFrames &&
    received.frameCount === expected.frameCount
  );
}

function makeDiagnosticContext(
  buffer: AudioBuffer,
  source: AnalysisSourceMetadata | undefined,
  plan: AnalysisPlan,
  capabilities: AnalysisCapabilities,
  requestId: string,
  startedAt: number,
): Omit<AudioAnalysisDiagnostics, 'schemaVersion' | 'code' | 'occurredAt' | 'stage' | 'error'> {
  return {
    requestId,
    elapsedMs: Math.round(performance.now() - startedAt),
    input: {
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      numberOfChannels: buffer.numberOfChannels,
      sampleLength: buffer.length,
    },
    source,
    plan,
    capabilities,
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  };
}

function makeAnalysisError(
  code: AudioAnalysisFailureCode,
  stage: AnalysisStage,
  cause: unknown,
  context: Omit<AudioAnalysisDiagnostics, 'schemaVersion' | 'code' | 'occurredAt' | 'stage' | 'error'>,
  worker?: AudioAnalysisDiagnostics['worker'],
  remoteError?: SerializedAnalysisError,
): AudioAnalysisError {
  const serialized = remoteError ?? serializeAnalysisError(cause, stage);
  const diagnostics: AudioAnalysisDiagnostics = {
    schemaVersion: 1,
    code,
    occurredAt: new Date().toISOString(),
    stage,
    error: serialized,
    ...context,
    worker,
  };
  const label = failureLabel(code);
  return new AudioAnalysisError(`${label}: ${serialized.message}`, diagnostics, cause);
}

function failureLabel(code: AudioAnalysisFailureCode): string {
  switch (code) {
    case 'worker-construction':
      return 'Analysis Worker could not be created';
    case 'worker-startup-timeout':
      return 'Analysis Worker did not start';
    case 'worker-stalled':
      return 'Analysis Worker stopped responding';
    case 'request-transfer':
      return 'Audio could not be transferred to the Analysis Worker';
    case 'message-deserialization':
      return 'Analysis Worker message could not be read';
    case 'invalid-result':
      return 'Analysis Worker returned an invalid result';
    case 'worker-reported':
      return 'Spectrum calculation failed';
    default:
      return 'Analysis Worker failed';
  }
}

function reportAnalysisFailure(error: AudioAnalysisError): void {
  console.error('[audio-analysis] Worker failure', {
    message: error.message,
    ...error.diagnostics,
  });
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `analysis-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

import type { AnalysisPlan, AnalysisStage } from './types';

export interface AnalyzeWorkerRequest {
  type: 'analyze';
  requestId: string;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  duration: number;
  plan: AnalysisPlan;
}

export interface SerializedAnalysisError {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
  stage: AnalysisStage;
  context?: Record<string, string | number | boolean | undefined>;
}

export interface WorkerReadyMessage {
  type: 'ready';
}

export interface WorkerPlanMessage {
  type: 'plan';
  requestId: string;
  plan: AnalysisPlan;
}

export interface WorkerProgressMessage {
  type: 'progress';
  requestId: string;
  stage: 'analyzing' | 'finalizing';
  frame: number;
  totalFrames: number;
}

export interface WorkerResultMessage {
  type: 'result';
  requestId: string;
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

export interface WorkerErrorMessage {
  type: 'error';
  requestId?: string;
  error: SerializedAnalysisError;
}

export type AnalysisWorkerRequest = AnalyzeWorkerRequest;
export type AnalysisWorkerMessage =
  | WorkerReadyMessage
  | WorkerPlanMessage
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

export function serializeAnalysisError(
  cause: unknown,
  stage: AnalysisStage,
  context?: SerializedAnalysisError['context'],
): SerializedAnalysisError {
  if (cause instanceof Error) {
    return {
      name: cause.name || 'Error',
      message: cause.message || String(cause),
      stack: cause.stack,
      cause: stringifyCause(cause.cause),
      stage,
      context,
    };
  }

  return {
    name: 'UnknownError',
    message: stringifyCause(cause) ?? 'Unknown audio analysis failure',
    stage,
    context,
  };
}

function stringifyCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;

  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

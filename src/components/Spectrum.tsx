import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { VisualizationProps } from '../types/audio';
import { SpectrumAnalysisProgress } from '../utils/audioProcessor';

// Define padding and freqLabels outside the component to ensure stable references
const PADDING_CONFIG = {
  top: 10,
  right: 64,
  bottom: 30,
  left: 16,
};

const FREQ_LABELS_CONFIG = [20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000];

interface SpectrumComponentProps extends VisualizationProps {
  audioDataPromise?: Promise<{ spectrumData: number[][] }>;
  analysisProgress?: SpectrumAnalysisProgress;
  onTimeChange?: (newTime: number) => void;
  audioFileHash?: string;
}

const Spectrum: React.FC<SpectrumComponentProps> = memo(({ data: initialData, height = 200, currentTime = 0, duration = 0, audioDataPromise, analysisProgress, onTimeChange, audioFileHash }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spectrumData, setSpectrumData] = useState<number[][]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [spectrumId, setSpectrumId] = useState<string>('');
  const [dpr, setDpr] = useState<number>(1);
  const [workerInitialized, setWorkerInitialized] = useState<boolean>(false);
  const [browserSupported, setBrowserSupported] = useState<boolean>(true);
  const workerRef = useRef<Worker | null>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const previousTimeRef = useRef<number>(currentTime);
  const isDraggingRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastDrawnTimeRef = useRef<number>(-1);
  const timeIndicatorLayerRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<number>(currentTime);

  useEffect(() => {
    currentTimeRef.current = currentTime;
    if (!isDraggingRef.current) {
      previousTimeRef.current = currentTime;
    }
  }, [currentTime]);

  // Frequency labels (y-axis) - from 20Hz to 16kHz
  // const freqLabels = [20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000]; // Moved outside

  // Padding settings
  // const padding = { // Moved outside
  //   top: 10,
  //   right: 64,
  //   bottom: 30,
  //   left: 16,
  // };

  // Initialize web worker and check browser support
  useEffect(() => {
    const isOffscreenCanvasSupported = 'OffscreenCanvas' in window;

    if (!isOffscreenCanvasSupported) {
      setBrowserSupported(false);
      setError('Your browser does not support OffscreenCanvas. Please use a modern browser like Chrome, Edge, or Firefox.');
      return;
    }

    if (isOffscreenCanvasSupported && !workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/spectrumDrawer.ts', import.meta.url), {
        type: 'module',
      });

      workerRef.current.onmessage = (event) => {
        if (event.data.type === 'drawComplete') {
          // setSpectrumDrawn(true); // Previously updated spectrumDrawn on worker completion
          // We don't need this reference anymore
        } else if (event.data.type === 'error') {
          setError(event.data.message || 'Error in spectrum worker');
        }
      };

      setWorkerInitialized(true);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  // Get spectrum data from props or promise
  useEffect(() => {
    if (initialData && Array.isArray(initialData) && initialData.length > 0) {
      if (Array.isArray(initialData[0])) {
        setSpectrumData(initialData as number[][]);
        // Use audioFileHash if available, otherwise fallback to timestamp
        const id = audioFileHash ? `spectrum-${audioFileHash}` : `spectrum-${Date.now()}`;
        setSpectrumId(id);
        setIsLoading(false);
        setError(null);
      } else {
        setSpectrumData([initialData as number[]]);
        const id = audioFileHash ? `spectrum-${audioFileHash}` : `spectrum-${Date.now()}`;
        setSpectrumId(id);
        setIsLoading(false);
        setError(null);
      }
    } else if (audioDataPromise) {
      setIsLoading(true);
      setError(null);
      audioDataPromise
        .then((result) => {
          if (Array.isArray(result.spectrumData) && result.spectrumData.length > 0) {
            setSpectrumData(result.spectrumData);
            const id = audioFileHash ? `spectrum-${audioFileHash}` : `spectrum-${Date.now()}`;
            setSpectrumId(id);
            setError(null);
          } else {
            console.warn('📊 Async spectrum data is empty or invalid.');
            setError('Spectrum data is empty or invalid.');
          }
        })
        .catch((err) => {
          console.error('📊 Error fetching spectrum data:', err);
          setError(err.message || 'Failed to load spectrum data.');
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
      setSpectrumData([]);
    }
  }, [initialData, audioDataPromise, audioFileHash]);

  // Handle progress updates without rendering partial data
  useEffect(() => {
    if (analysisProgress) {
      // Only set loading state based on progress
      if (analysisProgress.progress < 100) {
        setIsLoading(true);
      } else {
        setIsLoading(false);
      }

      // Only set spectrum data when analysis is fully complete
      if (analysisProgress.progress === 100 && analysisProgress.partialData && analysisProgress.partialData.length > 0) {
        setSpectrumData(analysisProgress.partialData);

        // Generate new spectrum ID on completion using audioFileHash if available
        if (!spectrumId && audioFileHash) {
          setSpectrumId(`spectrum-${audioFileHash}`);
        } else if (!spectrumId) {
          setSpectrumId(`spectrum-${Date.now()}`);
        }
      }
    }
  }, [analysisProgress, spectrumId, audioFileHash]);

  // Get device pixel ratio - only once
  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
  }, []);

  // Monitor container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
        setContainerHeight(height);
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [height]);

  // Set up OffscreenCanvas when canvas ref is available
  useEffect(() => {
    if (canvasRef.current && workerInitialized && workerRef.current && 'transferControlToOffscreen' in canvasRef.current && !offscreenCanvasRef.current && browserSupported) {
      offscreenCanvasRef.current = canvasRef.current.transferControlToOffscreen();

      workerRef.current.postMessage(
        {
          type: 'canvas',
          canvas: offscreenCanvasRef.current,
        },
        [offscreenCanvasRef.current]
      );
    }
  }, [canvasRef, workerInitialized, browserSupported]);

  // Convert current time to X position - memoized to prevent recreation
  const timeToPosition = useCallback(
    (time: number): number => {
      if (!duration || duration <= 0) return PADDING_CONFIG.left;
      const drawWidth = containerWidth - PADDING_CONFIG.left - PADDING_CONFIG.right;
      return PADDING_CONFIG.left + (time / duration) * drawWidth;
    },
    [containerWidth, duration] // Removed PADDING_CONFIG from dependencies as it's stable
  );

  // Convert X position to time - memoized to prevent recreation
  const positionToTime = useCallback(
    (xPos: number): number => {
      if (!duration || duration <= 0) return 0;
      const drawWidth = containerWidth - PADDING_CONFIG.left - PADDING_CONFIG.right;
      const relativeX = Math.max(0, Math.min(xPos - PADDING_CONFIG.left, drawWidth));
      return (relativeX / drawWidth) * duration;
    },
    [containerWidth, duration] // Removed PADDING_CONFIG from dependencies as it's stable
  );

  // Convert seconds to mm:ss format - memoized to prevent recreation
  const formatTimeToMMSS = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  const updateTimeIndicator = useCallback(() => {
    if (!timeIndicatorLayerRef.current || !containerRef.current || duration <= 0) {
      return;
    }

    const indicatorLine = timeIndicatorLayerRef.current.querySelector('.time-indicator-line') as HTMLElement | null;
    const timeLabel = timeIndicatorLayerRef.current.querySelector('.time-indicator-label') as HTMLElement | null;

    if (!indicatorLine || !timeLabel) {
      return;
    }

    const newIndicatorTime = currentTimeRef.current;

    if (Math.abs(lastDrawnTimeRef.current - newIndicatorTime) < 0.01) {
      return;
    }

    lastDrawnTimeRef.current = newIndicatorTime;
    const xPos = timeToPosition(newIndicatorTime);

    indicatorLine.style.left = `${xPos}px`;
    timeLabel.style.left = `${xPos}px`;
    timeLabel.textContent = formatTimeToMMSS(newIndicatorTime);
  }, [timeToPosition, formatTimeToMMSS, duration, containerHeight]);

  const scheduleIndicatorUpdate = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      updateTimeIndicator();
      animationFrameRef.current = null;
    });
  }, [updateTimeIndicator]);

  // Draw spectrum using web worker - memoized to prevent recreation
  // Importantly, DOES NOT depend on currentTime to prevent redraws when only time changes
  const postMessageToSpectrumWorker = useCallback(() => {
    if (!workerRef.current || !offscreenCanvasRef.current || !spectrumData.length || containerWidth === 0 || containerHeight === 0) return;

    // Send draw command to worker
    workerRef.current.postMessage({
      type: 'draw',
      spectrumData,
      width: containerWidth,
      height: containerHeight,
      dpr,
      duration,
      // DO NOT send currentTime to the worker - it's handled separately
      padding: PADDING_CONFIG,
      freqLabels: FREQ_LABELS_CONFIG,
    });
  }, [spectrumData, containerWidth, containerHeight, dpr, duration]); // Removed PADDING_CONFIG and FREQ_LABELS_CONFIG

  // Handle mouse down for dragging the time indicator
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || !duration || duration <= 0 || !onTimeChange) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      isDraggingRef.current = true;
      const newTime = positionToTime(x);
      currentTimeRef.current = newTime;
      updateTimeIndicator();
      if (onTimeChange) {
        onTimeChange(newTime);
      }
    },
    [duration, positionToTime, onTimeChange, updateTimeIndicator]
  );

  // Handle mouse move for dragging the time indicator
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current || !containerRef.current || !duration) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      const newTime = positionToTime(x);

      // Prevent overly frequent updates during dragging
      if (Math.abs(previousTimeRef.current - newTime) > 0.01) {
        previousTimeRef.current = newTime;

        if (onTimeChange) {
          onTimeChange(newTime);
        }
      }
    },
    [duration, positionToTime, onTimeChange]
  );

  // Handle mouse up to end dragging
  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Update time indicator when currentTime prop changes
  useEffect(() => {
    scheduleIndicatorUpdate();
  }, [currentTime, scheduleIndicatorUpdate]);

  // Draw spectrum data when required data is available
  // Critically, does NOT depend on currentTime to prevent unnecessary redraws
  useEffect(() => {
    if (!browserSupported) return;

    const canUseOffscreenCanvas = 'OffscreenCanvas' in window && workerInitialized && workerRef.current && offscreenCanvasRef.current;

    if (canUseOffscreenCanvas && spectrumData.length > 0 && containerWidth > 0 && containerHeight > 0) {
      console.log('Drawing spectrum using worker with data length:', spectrumData.length);
      // Even though we don't use spectrumDrawn anymore, we still need to call setSpectrumDrawn
      // for worker completion handling - we'll call a no-op function instead
      // setSpectrumDrawn(false);
      postMessageToSpectrumWorker();
    }
  }, [browserSupported, workerInitialized, spectrumData, postMessageToSpectrumWorker, containerWidth, containerHeight]);

  // Create initial time indicator DOM elements
  useEffect(() => {
    if (timeIndicatorLayerRef.current && containerRef.current && duration > 0 && containerHeight > 0 && !timeIndicatorLayerRef.current.querySelector('.time-indicator-line')) {
      const line = document.createElement('div');
      line.className = 'time-indicator-line absolute top-0 bottom-0 w-0.5 bg-red-500 z-10';
      line.style.height = `${containerHeight - PADDING_CONFIG.bottom - PADDING_CONFIG.top}px`;
      line.style.top = `${PADDING_CONFIG.top}px`;

      const timeLabel = document.createElement('div');
      timeLabel.className = 'time-indicator-label absolute text-xs text-white bg-black bg-opacity-50 px-1 py-0.5 rounded -mt-6 -ml-8 w-16 text-center';
      timeLabel.textContent = formatTimeToMMSS(currentTimeRef.current);

      timeIndicatorLayerRef.current.appendChild(line);
      timeIndicatorLayerRef.current.appendChild(timeLabel);

      scheduleIndicatorUpdate();
    }
  }, [containerHeight, duration, formatTimeToMMSS, scheduleIndicatorUpdate]);

  // Add document-level mouse event listeners for drag handling
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current || !duration || !onTimeChange) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const boundedX = Math.max(PADDING_CONFIG.left, Math.min(containerWidth - PADDING_CONFIG.right, x));
      const newTime = positionToTime(boundedX);
      if (Math.abs(previousTimeRef.current - newTime) > 0.01) {
        previousTimeRef.current = newTime;
        currentTimeRef.current = newTime;
        updateTimeIndicator();
        if (onTimeChange) {
          onTimeChange(newTime);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [containerWidth, duration, onTimeChange, positionToTime, updateTimeIndicator]);

  return (
    <div className="w-full">
      <h3 className="text-lg font-bold mb-2 text-gray-800 dark:text-gray-200">Frequency Spectrum</h3>
      <div ref={containerRef} className="relative border border-gray-200 dark:border-gray-700 rounded-xl py-4 pr-4 pl-0 bg-white/5 dark:bg-gray-900/30 backdrop-blur-sm overflow-hidden cursor-pointer" style={{ height: `${containerHeight + 8}px` }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {/* Progress bar */}
        {analysisProgress && analysisProgress.progress < 100 && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-700 z-10">
            <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${analysisProgress.progress}%` }} />
          </div>
        )}

        {isLoading && !spectrumData.length && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">Loading spectrum data...</div>}

        {isLoading && analysisProgress && <div className="absolute top-2 right-2 px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs rounded z-20">Analyzing: {analysisProgress.progress}% complete</div>}

        {error && <div className="absolute inset-0 flex items-center justify-center z-20 text-red-500 p-4 text-center">{error}</div>}

        {!browserSupported && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-amber-600 p-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-lg font-bold mb-2">Browser Not Supported</div>
            <p>Your browser does not support OffscreenCanvas.</p>
            <p>Please use a modern browser like Chrome, Edge, or Firefox.</p>
          </div>
        )}

        {!isLoading && !error && spectrumData.length === 0 && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">No spectrum data to display.</div>}

        {/* Base canvas for spectrum visualization */}
        <canvas ref={canvasRef} className="w-full h-full absolute top-0 left-0" />

        {/* Separate layer for time indicator - managed via direct DOM for performance */}
        <div ref={timeIndicatorLayerRef} className="absolute inset-0 pointer-events-none"></div>
      </div>
    </div>
  );
});

export default Spectrum;

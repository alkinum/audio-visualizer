import React, { useRef, useEffect, useCallback, useState, memo } from 'react';
import { VisualizationProps } from '../types/audio';

// Define padding outside the component to ensure stable references
const WAVEFORM_PADDING_CONFIG = {
  top: 20,
  right: 64, // Unified with Spectrum.tsx
  bottom: 20,
  left: 16,
};

interface WaveformVisualizationProps extends VisualizationProps {
  onTimeChange?: (newTime: number) => void; // Add onTimeChange to props
}

const Waveform: React.FC<WaveformVisualizationProps> = memo(({
  data,
  height = 100,
  color = '#3B82F6',
  gradientColor = '#93C5FD',
  currentTime = 0,
  duration = 0,
  onTimeChange, // Destructure onTimeChange
}) => {
  const [showChannels, setShowChannels] = useState<'combined' | 'separate'>('combined');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [browserSupported, setBrowserSupported] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const workerRef = useRef<Worker | null>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const [workerInitialized, setWorkerInitialized] = useState<boolean>(false);
  const timeIndicatorLayerRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<number>(currentTime);
  const lastDrawnTimeRef = useRef<number>(-1);
  const animationFrameRef = useRef<number | null>(null);
  const [waveformDrawn, setWaveformDrawn] = useState(false);
  const isDraggingRef = useRef<boolean>(false); // Added for dragging
  const previousTimeRef = useRef<number>(currentTime); // Added for dragging


  useEffect(() => {
    currentTimeRef.current = currentTime;
    if (!isDraggingRef.current) {
        previousTimeRef.current = currentTime;
    }
  }, [currentTime]);

  useEffect(() => {
    const isOffscreenCanvasSupported = 'OffscreenCanvas' in window;

    if (!isOffscreenCanvasSupported) {
      setBrowserSupported(false);
      setError('Your browser does not support OffscreenCanvas. Please use a modern browser like Chrome, Edge, or Firefox.');
      return;
    }

    if (isOffscreenCanvasSupported && !workerRef.current) {
      try {
        workerRef.current = new Worker(new URL('../workers/waveformDrawer.ts', import.meta.url), {
          type: 'module',
        });

        workerRef.current.onmessage = (event) => {
          if (event.data.type === 'drawComplete') {
            setIsLoading(false);
            setWaveformDrawn(true);
          } else if (event.data.type === 'error') {
            setError(event.data.message || 'Error in waveform worker');
            setIsLoading(false);
          }
        };

        setWorkerInitialized(true);
      } catch (err) {
        console.error('Failed to initialize waveform worker:', err);
        setError('Failed to initialize waveform visualization.');
        setBrowserSupported(false);
      }
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

  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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

  const timeToPosition = useCallback(
    (time: number): number => {
      if (!duration || duration <= 0) return WAVEFORM_PADDING_CONFIG.left;
      const drawWidth = containerWidth - WAVEFORM_PADDING_CONFIG.left - WAVEFORM_PADDING_CONFIG.right;
      return WAVEFORM_PADDING_CONFIG.left + (time / duration) * drawWidth;
    },
    [containerWidth, duration] // WAVEFORM_PADDING_CONFIG is stable
  );

  // Convert X position to time - memoized to prevent recreation (Added for dragging)
  const positionToTime = useCallback(
    (xPos: number): number => {
      if (!duration || duration <= 0) return 0;
      const drawWidth = containerWidth - WAVEFORM_PADDING_CONFIG.left - WAVEFORM_PADDING_CONFIG.right;
      const relativeX = Math.max(0, Math.min(xPos - WAVEFORM_PADDING_CONFIG.left, drawWidth));
      return (relativeX / drawWidth) * duration;
    },
    [containerWidth, duration] // WAVEFORM_PADDING_CONFIG is stable
  );

  const formatTimeToMMSS = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  const updateTimeIndicator = useCallback(() => {
    if (!timeIndicatorLayerRef.current || !containerRef.current || duration <= 0) {
      return; // Essential elements/data not ready
    }

    const indicatorLine = timeIndicatorLayerRef.current.querySelector('.time-indicator-line') as HTMLElement | null;
    const timeLabel = timeIndicatorLayerRef.current.querySelector('.time-indicator-label') as HTMLElement | null;

    if (!indicatorLine || !timeLabel) {
      // Indicator DOM elements haven't been created yet.
      return;
    }
    
    const currentIndicatorTime = currentTimeRef.current;
    if (Math.abs(lastDrawnTimeRef.current - currentIndicatorTime) < 0.01) {
      return; // No significant change
    }

    lastDrawnTimeRef.current = currentIndicatorTime;
    const xPos = timeToPosition(currentIndicatorTime);
    indicatorLine.style.left = `${xPos}px`;
    timeLabel.style.left = `${xPos}px`;
    timeLabel.textContent = formatTimeToMMSS(currentIndicatorTime);
  }, [timeToPosition, formatTimeToMMSS, duration, height]); // Removed waveformDrawn. height for line height calc in creation.

  const scheduleIndicatorUpdate = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      updateTimeIndicator();
      animationFrameRef.current = null;
    });
  }, [updateTimeIndicator]);

  const drawWaveformUsingWorker = useCallback(() => {
    if (!workerRef.current || !offscreenCanvasRef.current || !data || containerWidth === 0) return;
    setIsLoading(true);
    setWaveformDrawn(false); // Set to false before redrawing
    workerRef.current.postMessage({
      type: 'draw',
      data,
      width: containerWidth,
      height,
      padding: WAVEFORM_PADDING_CONFIG, // Use stable config
      color,
      gradientColor,
      duration,
      showChannels,
      dpr: window.devicePixelRatio || 1,
    });
  }, [data, containerWidth, height, color, gradientColor, duration, showChannels]); // Removed padding

  useEffect(() => {
    if (!browserSupported) return;
    const canUseOffscreenCanvas = 'OffscreenCanvas' in window && workerInitialized && workerRef.current && offscreenCanvasRef.current;
    if (canUseOffscreenCanvas && data && containerWidth > 0 && height > 0) {
      drawWaveformUsingWorker();
    }
  }, [browserSupported, workerInitialized, drawWaveformUsingWorker, data, containerWidth, height, showChannels]); // Added height

  useEffect(() => {
    if (waveformDrawn && timeIndicatorLayerRef.current && !timeIndicatorLayerRef.current.querySelector('.time-indicator-line')) {
      const line = document.createElement('div');
      line.className = 'time-indicator-line absolute top-0 bottom-0 w-0.5 bg-red-500 z-10';
      line.style.height = `${height - WAVEFORM_PADDING_CONFIG.bottom - WAVEFORM_PADDING_CONFIG.top}px`;
      line.style.top = `${WAVEFORM_PADDING_CONFIG.top}px`;
      const timeLabel = document.createElement('div');
      timeLabel.className = 'time-indicator-label absolute text-xs text-white bg-black bg-opacity-50 px-1 py-0.5 rounded -mt-6 -ml-8 w-16 text-center';
      timeLabel.textContent = formatTimeToMMSS(currentTimeRef.current); // Use ref for initial setup
      timeIndicatorLayerRef.current.appendChild(line);
      timeIndicatorLayerRef.current.appendChild(timeLabel);
      scheduleIndicatorUpdate();
    }
  }, [waveformDrawn, height, currentTime, formatTimeToMMSS, scheduleIndicatorUpdate]); // Added currentTime to re-evaluate if necessary

  useEffect(() => {
    if (waveformDrawn) {
      scheduleIndicatorUpdate();
    }
  }, [currentTime, scheduleIndicatorUpdate, waveformDrawn]);


  // Event handlers for dragging time indicator (Copied and adapted from Spectrum.tsx)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || !duration || duration <= 0 || !onTimeChange) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      isDraggingRef.current = true;
      const newTime = positionToTime(x);
      currentTimeRef.current = newTime;
      updateTimeIndicator(); // Immediate visual feedback
      if (onTimeChange) {
        onTimeChange(newTime);
      }
    },
    [duration, positionToTime, onTimeChange, updateTimeIndicator]
  );

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
       isDraggingRef.current = false;
      // Optional: snap to final position or trigger a final update if needed
      // if (onTimeChange && currentTimeRef.current !== previousTimeRef.current) {
      //   onTimeChange(currentTimeRef.current);
      // }
    }
  }, [/* onTimeChange */]); // onTimeChange can be added if a final call is needed

  // Add document-level mouse event listeners for drag handling (Copied and adapted)
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current || !duration || !onTimeChange) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const boundedX = Math.max(WAVEFORM_PADDING_CONFIG.left, Math.min(containerWidth - WAVEFORM_PADDING_CONFIG.right, x));
      const newTime = positionToTime(boundedX);
      if (Math.abs(previousTimeRef.current - newTime) > 0.01) {
          previousTimeRef.current = newTime;
          currentTimeRef.current = newTime;
          updateTimeIndicator(); // Immediate visual feedback
          if (onTimeChange) {
            onTimeChange(newTime);
          }
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        // if (onTimeChange && currentTimeRef.current !== previousTimeRef.current) {
        //   onTimeChange(currentTimeRef.current); // Send final time
        // }
      }
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
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">Waveform</h3>
        {typeof data === 'object' && data && 'left' in data && 'right' in data && ( // Added null check for data
          <button
            onClick={() => setShowChannels((prev) => (prev === 'combined' ? 'separate' : 'combined'))}
            className="px-3 py-1.5 text-xs font-medium rounded-md
              bg-blue-50 text-blue-600 border border-blue-100
              dark:bg-gray-800 dark:text-blue-400 dark:border-gray-700
              hover:bg-blue-100 dark:hover:bg-gray-700
              active:bg-blue-200 dark:active:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-blue-300/30 dark:focus:ring-blue-700/30
              shadow-sm transition-all duration-150 ease-in-out"
          >
            {showChannels === 'combined' ? 'Split Channels' : 'Combined Channels'}
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative border border-gray-200 dark:border-gray-700 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm overflow-hidden cursor-pointer" // Added cursor-pointer
        style={{ height: `${height}px` }}
        onMouseDown={handleMouseDown} // Added mouse event
        onMouseLeave={handleMouseUp} // End drag if mouse leaves container
        // onMouseUp is handled by global listener
      >
        {isLoading && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">Loading waveform...</div>}
        {/* ... (error and browserNotSupported JSX remains the same) ... */}
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

        <canvas ref={canvasRef} className="w-full h-full" /> {/* Removed style here, height is on parent */}
        <div ref={timeIndicatorLayerRef} className="absolute inset-0 pointer-events-none"></div>
      </div>
    </div>
  );
});

export default Waveform;

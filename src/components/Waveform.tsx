import React, { useRef, useEffect, useCallback, useState, memo } from 'react';
import { VisualizationProps } from '../types/audio';

const Waveform: React.FC<VisualizationProps> = memo(({ data, height = 100, color = '#3B82F6', gradientColor = '#93C5FD', currentTime = 0, duration = 0 }) => {
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

  // 内边距设置，为绘制区域预留空间
  const padding = {
    top: 20,
    right: 42, // 为右侧电平标签预留空间
    bottom: 20,
    left: 16,
  };

  // 更新 ref 当 prop 变化时，避免触发重新渲染
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // 检查浏览器支持并初始化 Web Worker
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

  // 监听容器大小变化
  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    // 初始设置尺寸
    updateContainerSize();

    // 添加调整大小监听器
    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 设置 OffscreenCanvas
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

  // 转换当前时间到 X 坐标位置
  const timeToPosition = useCallback(
    (time: number): number => {
      if (!duration || duration <= 0) return padding.left;
      const drawWidth = containerWidth - padding.left - padding.right;
      return padding.left + (time / duration) * drawWidth;
    },
    [containerWidth, padding, duration]
  );

  // 将秒转换为 mm:ss 格式
  const formatTimeToMMSS = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  // 通过 DOM 直接更新时间指示器位置以提高性能
  const updateTimeIndicator = useCallback(() => {
    if (!timeIndicatorLayerRef.current || !duration || duration <= 0 || !waveformDrawn) return;

    const currentTime = currentTimeRef.current;

    // 如果位置变化不够明显，跳过更新
    if (Math.abs(lastDrawnTimeRef.current - currentTime) < 0.01) {
      return;
    }

    lastDrawnTimeRef.current = currentTime;

    // 计算时间指示器位置
    const xPos = timeToPosition(currentTime);

    // 通过直接 DOM 操作更新指示器位置
    const indicatorLine = timeIndicatorLayerRef.current.querySelector('.time-indicator-line') as HTMLElement;
    const timeLabel = timeIndicatorLayerRef.current.querySelector('.time-indicator-label') as HTMLElement;

    if (indicatorLine && timeLabel) {
      indicatorLine.style.left = `${xPos}px`;
      timeLabel.style.left = `${xPos}px`;
      timeLabel.textContent = formatTimeToMMSS(currentTime);
    }
  }, [timeToPosition, formatTimeToMMSS, duration, waveformDrawn]);

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
    setWaveformDrawn(false);

    workerRef.current.postMessage({
      type: 'draw',
      data,
      width: containerWidth,
      height,
      padding,
      color,
      gradientColor,
      duration,
      showChannels,
      dpr: window.devicePixelRatio || 1,
    });
  }, [data, containerWidth, height, padding, color, gradientColor, duration, showChannels]);

  useEffect(() => {
    if (!browserSupported) return;

    const canUseOffscreenCanvas = 'OffscreenCanvas' in window && workerInitialized && workerRef.current && offscreenCanvasRef.current;

    if (canUseOffscreenCanvas && data) {
      drawWaveformUsingWorker();
    }
  }, [browserSupported, workerInitialized, drawWaveformUsingWorker, data, containerWidth, showChannels]);

  useEffect(() => {
    if (waveformDrawn && timeIndicatorLayerRef.current && !timeIndicatorLayerRef.current.querySelector('.time-indicator-line')) {
      // 创建指示器 DOM 元素
      const line = document.createElement('div');
      line.className = 'time-indicator-line absolute top-0 bottom-0 w-0.5 bg-red-500 z-10';
      line.style.height = `${height - padding.bottom - padding.top}px`;
      line.style.top = `${padding.top}px`;

      const timeLabel = document.createElement('div');
      timeLabel.className = 'time-indicator-label absolute text-xs text-white bg-black bg-opacity-50 px-1 py-0.5 rounded -mt-6 -ml-8 w-16 text-center';
      timeLabel.textContent = formatTimeToMMSS(currentTime);

      timeIndicatorLayerRef.current.appendChild(line);
      timeIndicatorLayerRef.current.appendChild(timeLabel);

      scheduleIndicatorUpdate();
    }
  }, [waveformDrawn, height, padding, currentTime, formatTimeToMMSS, scheduleIndicatorUpdate]);

  useEffect(() => {
    if (waveformDrawn) {
      scheduleIndicatorUpdate();
    }
  }, [currentTime, scheduleIndicatorUpdate, waveformDrawn]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">Waveform</h3>
        {typeof data === 'object' && 'left' in data && (
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
      <div ref={containerRef} className="relative border border-gray-200 dark:border-gray-700 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm overflow-hidden">
        {isLoading && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">Loading waveform...</div>}

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

        <canvas ref={canvasRef} className="w-full h-full" style={{ height: `${height}px` }} />

        <div ref={timeIndicatorLayerRef} className="absolute inset-0 pointer-events-none"></div>
      </div>
    </div>
  );
});

export default Waveform;

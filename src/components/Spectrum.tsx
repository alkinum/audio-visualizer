import React, { useRef, useEffect, useState, useCallback } from 'react';
import { VisualizationProps } from '../types/audio';
import { SpectrumAnalysisProgress } from '../utils/audioProcessor';

interface SpectrumComponentProps extends VisualizationProps {
  audioDataPromise?: Promise<{ spectrumData: number[][] }>;
  analysisProgress?: SpectrumAnalysisProgress;
}

const Spectrum: React.FC<SpectrumComponentProps> = ({
  data: initialData, // 重命名以避免与内部状态冲突
  height = 200,
  currentTime = 0,
  duration = 0,
  audioDataPromise,
  analysisProgress,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spectrumData, setSpectrumData] = useState<number[][]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0); // 存储容器宽度
  const [containerHeight, setContainerHeight] = useState<number>(0); // 存储容器高度
  const [spectrumId, setSpectrumId] = useState<string>(''); // 用于标识当前频谱数据
  const [dpr, setDpr] = useState<number>(1); // 设备像素比
  const [viewStartTime, setViewStartTime] = useState<number>(0); // 当前可视区域的起始时间位置

  // 频率标签（y轴）- 从20Hz到16kHz，使用对数分布，增加了更多低频标签
  const freqLabels = [20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000];

  // 内边距设置，为标签和内容预留空间
  const padding = {
    top: 10,
    right: 64, // 增大右侧边距确保标签完全显示
    bottom: 30,
    left: 16, // 添加图表内部的左侧内边距
  };

  // 获取频谱数据
  useEffect(() => {
    if (initialData && Array.isArray(initialData) && initialData.length > 0) {
      // 如果直接传递了二维数组数据
      if (Array.isArray(initialData[0])) {
        setSpectrumData(initialData as number[][]);
        setSpectrumId(`spectrum-${Date.now()}`); // 生成新的频谱ID
        setIsLoading(false);
        setError(null);
      } else {
        // 单个一维数组，可能是单个时间片段的数据
        setSpectrumData([initialData as number[]]);
        setSpectrumId(`spectrum-${Date.now()}`); // 生成新的频谱ID
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
            setSpectrumId(`spectrum-${Date.now()}`); // 生成新的频谱ID
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
  }, [initialData, audioDataPromise]);

  // 处理进度更新和渐进式渲染
  useEffect(() => {
    if (analysisProgress?.partialData && analysisProgress.partialData.length > 0) {
      setSpectrumData(analysisProgress.partialData);

      // 仅在首次接收部分数据时设置新ID
      if (!spectrumId) {
        setSpectrumId(`spectrum-${Date.now()}`);
      }

      // 即使还在加载中，也显示部分数据
      if (analysisProgress.progress < 100) {
        setIsLoading(true);
      } else {
        setIsLoading(false);
      }
    }
  }, [analysisProgress, spectrumId]);

  // 获取设备像素比
  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
  }, []);

  // 监听容器大小变化
  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      if (containerRef.current) {
        // 设置容器尺寸
        setContainerWidth(containerRef.current.clientWidth);
        setContainerHeight(height); // 使用传入的高度参数
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
  }, [height]);

  // 更新当前可视区域的起始时间位置
  useEffect(() => {
    if (duration && duration > 0 && spectrumData.length > 0) {
      // 计算当前播放时间对应的位置
      const timePercentage = currentTime / duration;
      setViewStartTime(timePercentage);
    }
  }, [currentTime, duration, spectrumData.length]);

  // 计算对数刻度的频率位置 - 改进对数映射以增强低频范围的精度
  const getFrequencyY = useCallback(
    (freq: number, drawHeight: number): number => {
      // 增强低频域的可视空间，使用改进的对数缩放
      // 对于Adobe Audition风格的频谱，我们增强低频域的显示比例
      const logMin = Math.log10(20); // 最低频率保持为20Hz
      const logMax = Math.log10(16000); // 最高频率保持为16kHz
      
      // 增加非线性因子来强调低频区域
      const enhancedLog = Math.log10(freq);
      // 注意：这里使用1减去比率，意味着低频(小频率值)会映射到画布底部(大y值)
      const yRatio = 1 - (enhancedLog - logMin) / (logMax - logMin);
      
      return padding.top + yRatio * (drawHeight - padding.top - padding.bottom);
    },
    [padding]
  );

  // 计算当前播放位置的指示器位置（百分比）
  const getIndicatorPosition = useCallback(() => {
    if (!duration || duration <= 0) return 0;
    return (currentTime / duration) * 100;
  }, [currentTime, duration]);

  // 将秒数转换为mm:ss格式
  const formatTimeToMMSS = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  // 创建基于信号强度的颜色函数，而不是基于位置的渐变
  const getSignalColor = useCallback((magnitude: number): string => {
    // 使用信号强度来决定颜色
    // 高信号强度 = 亮橙色
    // 低信号强度 = 深紫色
    
    // 首先将绝对信号值映射到0-1范围，用于颜色映射
    // 根据经验，对数强度值通常在0到0.3之间
    const normalizedMagnitude = Math.min(1, magnitude / 0.3);
    
    // 颜色定义
    const colors = {
      low: { r: 59, g: 7, b: 100 },      // 深紫色 #3B0764
      mediumLow: { r: 126, g: 34, b: 206 }, // 紫色 #7E22CE
      medium: { r: 219, g: 39, b: 119 },   // 粉红色 #DB2777
      mediumHigh: { r: 225, g: 29, b: 72 }, // 红色 #E11D48
      high: { r: 249, g: 115, b: 22 }    // 橙色 #F97316
    };
    
    // 基于映射后的信号强度插值颜色
    let r, g, b;
    
    if (normalizedMagnitude < 0.25) {
      // 从深紫色到紫色
      const t = normalizedMagnitude / 0.25;
      r = Math.round(colors.low.r + t * (colors.mediumLow.r - colors.low.r));
      g = Math.round(colors.low.g + t * (colors.mediumLow.g - colors.low.g));
      b = Math.round(colors.low.b + t * (colors.mediumLow.b - colors.low.b));
    } else if (normalizedMagnitude < 0.5) {
      // 从紫色到粉红色
      const t = (normalizedMagnitude - 0.25) / 0.25;
      r = Math.round(colors.mediumLow.r + t * (colors.medium.r - colors.mediumLow.r));
      g = Math.round(colors.mediumLow.g + t * (colors.medium.g - colors.mediumLow.g));
      b = Math.round(colors.mediumLow.b + t * (colors.medium.b - colors.mediumLow.b));
    } else if (normalizedMagnitude < 0.75) {
      // 从粉红色到红色
      const t = (normalizedMagnitude - 0.5) / 0.25;
      r = Math.round(colors.medium.r + t * (colors.mediumHigh.r - colors.medium.r));
      g = Math.round(colors.medium.g + t * (colors.mediumHigh.g - colors.medium.g));
      b = Math.round(colors.medium.b + t * (colors.medium.b - colors.medium.b));
    } else {
      // 从红色到橙色
      const t = (normalizedMagnitude - 0.75) / 0.25;
      r = Math.round(colors.mediumHigh.r + t * (colors.high.r - colors.mediumHigh.r));
      g = Math.round(colors.mediumHigh.g + t * (colors.high.g - colors.mediumHigh.g));
      b = Math.round(colors.mediumHigh.b + t * (colors.high.b - colors.mediumHigh.b));
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  }, []);

  // 绘制频谱图到Canvas
  const drawSpectrumToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrumData.length) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // 获取容器宽度并预留右侧标签空间
    const width = containerWidth - padding.right;
    const canvasHeight = containerHeight;

    // 根据设备像素比调整canvas尺寸
    canvas.width = containerWidth * dpr; // 使用完整宽度
    canvas.height = canvasHeight * dpr;

    // 设置CSS尺寸
    canvas.style.width = `${containerWidth}px`; // 使用完整宽度
    canvas.style.height = `${canvasHeight}px`;

    // 应用DPI缩放
    ctx.scale(dpr, dpr);

    // 清除Canvas
    ctx.clearRect(0, 0, containerWidth, canvasHeight);

    // 计算可绘制区域
    const drawWidth = width;
    const drawHeight = canvasHeight - padding.top - padding.bottom;

    // 绘制背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(padding.left, padding.top, drawWidth, drawHeight);

    // 绘制边框
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, padding.top, drawWidth, drawHeight);

    // 绘制频率网格线
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)';
    ctx.lineWidth = 1;

    // 绘制频率标签和网格线
    ctx.textBaseline = 'middle';
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(128, 128, 128, 0.8)'; // 增加标签对比度
    ctx.textAlign = 'left';

    freqLabels.forEach((freq) => {
      const yPos = getFrequencyY(freq, canvasHeight);

      // 绘制网格线
      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + drawWidth, yPos);
      ctx.stroke();

      // 绘制频率标签 (右侧)
      const label = freq < 1000 ? `${freq}Hz` : `${freq / 1000}kHz`;
      ctx.fillText(label, padding.left + drawWidth + 5, yPos);
    });

    // 处理空数据情况
    if (spectrumData.length === 0) {
      return;
    }

    // 计算时间轴上的缩放因子
    // 我们需要将所有时间片段适配到可绘制区域内
    const timeBarWidth = drawWidth / spectrumData.length;

    // 绘制时间轴刻度和标签
    // 确定时间间隔
    const timeIntervals = Math.min(10, spectrumData.length);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let i = 0; i <= timeIntervals; i++) {
      const ratio = i / timeIntervals;
      const xPos = padding.left + ratio * drawWidth;
      const timeValue = ratio * duration;

      // 绘制时间刻度线
      ctx.beginPath();
      ctx.moveTo(xPos, canvasHeight - padding.bottom);
      ctx.lineTo(xPos, canvasHeight - padding.bottom + 5);
      ctx.stroke();

      // 绘制时间标签，使用mm:ss格式
      ctx.fillText(formatTimeToMMSS(timeValue), xPos, canvasHeight - padding.bottom + 8);
    }

    // 绘制频谱数据
    // FFT结果数组中，索引0是DC分量(0Hz)，索引越大频率越高
    for (let timeIdx = 0; timeIdx < spectrumData.length; timeIdx++) {
      const timeSlice = spectrumData[timeIdx];
      if (!timeSlice || timeSlice.length === 0) continue;

      // 计算时间片段的X坐标
      const xPos = padding.left + timeIdx * timeBarWidth;

      // 绘制每个频率块
      for (let freqIdx = 0; freqIdx < timeSlice.length; freqIdx++) {
        const magnitude = timeSlice[freqIdx];

        // 使用更低的可见性阈值，使更多信号可见
        if (magnitude < 0.001) continue;

        // 计算当前频率块在总频率范围中的比例位置
        // 正确映射频率索引到实际频率 (使用FFT原理)
        const nyquistFreq = 22050; // 修正为标准44.1kHz采样率的一半
        const binCount = timeSlice.length; // 通常是1024或2048

        // 计算该频率块对应的实际频率，保持低索引=低频率，高索引=高频率
        const startFreq = Math.max(20, (freqIdx * nyquistFreq) / binCount);
        const endFreq = Math.max(20, ((freqIdx + 1) * nyquistFreq) / binCount);

        // 对数缩放的Y坐标，确保低频区域有合理的视觉空间
        const yStart = getFrequencyY(startFreq, canvasHeight);
        const yEnd = getFrequencyY(endFreq, canvasHeight);

        // 计算矩形高度 (确保至少1像素)
        const rectHeight = Math.max(1, yStart - yEnd);

        // 使用信号强度同时决定颜色和透明度
        ctx.fillStyle = getSignalColor(magnitude);

        // 根据绝对信号强度设置适当的透明度
        // 通常对数处理后的信号值在0-0.3之间，将其映射到0.05-1.0的透明度范围
        const alpha = 0.05 + Math.min(0.95, magnitude * 3.5); 
        ctx.globalAlpha = alpha;

        // 绘制矩形 - 绘制起点是较高频率(较小Y值)，向下绘制到较低频率(较大Y值)
        ctx.fillRect(xPos, yEnd, timeBarWidth, rectHeight);
      }
    }

    // 重置透明度
    ctx.globalAlpha = 1.0;
  }, [spectrumData, containerWidth, containerHeight, duration, dpr, getFrequencyY, getSignalColor, freqLabels, padding, viewStartTime, formatTimeToMMSS]);

  // 在数据、视图位置或容器尺寸变化时重新绘制
  useEffect(() => {
    drawSpectrumToCanvas();
  }, [drawSpectrumToCanvas]);

  return (
    <div className="w-full">
      <h3 className="text-lg font-bold mb-2 text-gray-800 dark:text-gray-200">Frequency Spectrum</h3>
      <div ref={containerRef} className="relative border border-gray-200 dark:border-gray-700 rounded-xl py-4 pr-4 pl-0 bg-white/5 dark:bg-gray-900/30 backdrop-blur-sm overflow-hidden" style={{ height: `${containerHeight + 8}px` }}>
        {/* 显示进度条 */}
        {analysisProgress && analysisProgress.progress < 100 && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-700 z-10">
            <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${analysisProgress.progress}%` }} />
          </div>
        )}

        {/* 时间指示器覆盖层 */}
        {duration > 0 && currentTime <= duration && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
            style={{
              left: `${padding.left + (getIndicatorPosition() * (containerWidth - padding.left - padding.right)) / 100}px`,
              height: `calc(100% - ${padding.bottom + 8}px)`,
              top: `${padding.top + 4}px`,
            }}
          />
        )}

        {isLoading && !spectrumData.length && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">正在加载频谱数据...</div>}

        {isLoading && spectrumData.length > 0 && analysisProgress && <div className="absolute top-2 right-2 px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs rounded z-20">分析中: {analysisProgress.progress}% 完成</div>}

        {error && <div className="absolute inset-0 flex items-center justify-center z-20 text-red-500">错误: {error}</div>}

        {!isLoading && !error && spectrumData.length === 0 && <div className="absolute inset-0 flex items-center justify-center z-20 text-gray-500">没有频谱数据可显示。</div>}

        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default Spectrum;

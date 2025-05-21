import React, { useRef, useEffect, useCallback, useState } from 'react';
import { VisualizationProps } from '../types/audio';

const Waveform: React.FC<VisualizationProps> = ({ 
  data, 
  height = 100,
  color = '#3B82F6',
  gradientColor = '#93C5FD',
  currentTime = 0,
  duration = 0
}) => {
  const [showChannels, setShowChannels] = useState<'combined' | 'separate'>('combined');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  
  // 内边距设置，为绘制区域预留空间
  const padding = {
    top: 20,
    right: 42,  // 为右侧电平标签预留空间
    bottom: 20,
    left: 16
  };
  
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
  
  // 辅助函数：判断是否使用分离通道模式
  const isSeparateChannelsMode = useCallback(() => {
    return showChannels === 'separate' && typeof data === 'object' && 'left' in data;
  }, [showChannels, data]);
  
  // 绘制波形图及标签
  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !containerRef.current || !data) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    const width = containerWidth;
    const dpr = window.devicePixelRatio || 1;
    
    // 设置画布大小和缩放
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    // 清除画布
    ctx.clearRect(0, 0, width, height);
    
    // 可绘制区域
    const drawableWidth = width - padding.left - padding.right;
    const drawableHeight = height - padding.top - padding.bottom;
    
         // 绘制背景 - 透明
     ctx.clearRect(0, 0, width, height);
    
      // 绘制分隔线和电平标签
      if (isSeparateChannelsMode()) {
        // 双通道模式
        const gapBetweenChannels = 10;
        const channelHeight = (drawableHeight - gapBetweenChannels) / 2;
        
        // 第一个通道区域
        const ch1Top = padding.top;
        const ch1Center = ch1Top + channelHeight / 2;
        const ch1Bottom = ch1Top + channelHeight;
        
        // 第二个通道区域
        const ch2Top = ch1Bottom + gapBetweenChannels;
        const ch2Center = ch2Top + channelHeight / 2;
      
      // 绘制通道背景
      drawChannelBackground(ctx, padding.left, ch1Top, drawableWidth, channelHeight);
      drawChannelBackground(ctx, padding.left, ch2Top, drawableWidth, channelHeight);
      
      // 绘制第一个通道的电平线和标签
      drawLevelLines(ctx, padding.left, ch1Top, drawableWidth, channelHeight, ch1Center);
      
      // 绘制第二个通道的电平线和标签
      drawLevelLines(ctx, padding.left, ch2Top, drawableWidth, channelHeight, ch2Center);
      
      // 绘制双通道波形数据
      if (typeof data === 'object' && 'left' in data) {
        drawChannelData(ctx, data.left, padding.left, ch1Center, drawableWidth, channelHeight);
        drawChannelData(ctx, data.right, padding.left, ch2Center, drawableWidth, channelHeight);
      }
    } else {
      // 单通道模式
      const centerY = padding.top + drawableHeight / 2;
      
      // 绘制通道背景
      drawChannelBackground(ctx, padding.left, padding.top, drawableWidth, drawableHeight);
      
      // 绘制电平线和标签
      drawLevelLines(ctx, padding.left, padding.top, drawableWidth, drawableHeight, centerY);
      
      // 绘制波形数据
      if (typeof data === 'object' && 'left' in data) {
        drawChannelData(ctx, data.combined, padding.left, centerY, drawableWidth, drawableHeight);
      } else if (Array.isArray(data)) {
        if (Array.isArray(data[0])) {
          drawChannelData(ctx, data[0], padding.left, centerY, drawableWidth, drawableHeight);
        } else {
          drawChannelData(ctx, data as number[], padding.left, centerY, drawableWidth, drawableHeight);
        }
      }
    }
    
    // 绘制时间指示器
    if (duration > 0 && currentTime <= duration) {
      const position = padding.left + (currentTime / duration) * drawableWidth;
      
      ctx.strokeStyle = '#FF5252';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(position, padding.top);
      ctx.lineTo(position, height - padding.bottom);
      ctx.stroke();
    }
    
  }, [data, height, containerWidth, padding, showChannels, isSeparateChannelsMode, color, gradientColor, currentTime, duration]);
  
     // 绘制通道背景
   const drawChannelBackground = (
     ctx: CanvasRenderingContext2D,
     x: number,
     y: number,
     width: number,
     height: number
   ) => {
     // 绘制边框
     ctx.strokeStyle = 'rgba(180, 180, 180, 0.3)';
     ctx.lineWidth = 0.5;
     ctx.strokeRect(x, y, width, height);
   };
  
  // 绘制电平线和标签
  const drawLevelLines = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    centerY: number
  ) => {
         // 电平标记值 (单位：dB)
     const levelMarks = [
       { level: 0, percentage: 1.0 },   // 0dB (最大电平)
       { level: -3, percentage: 0.7 },
       { level: -6, percentage: 0.5 },
       { level: -12, percentage: 0.25 }
     ];
    
    // 绘制中心线
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, centerY);
    ctx.lineTo(x + width, centerY);
    ctx.stroke();
    
         // 设置文本样式
     ctx.font = '8px Arial';
     ctx.fillStyle = '#666';
     ctx.textAlign = 'left';
     ctx.textBaseline = 'middle';
    
    // 绘制中心线标签 (-∞ dB)
    ctx.fillText('-∞ dB', x + width + 5, centerY);
    
    // 绘制上半部分电平线和标签
    levelMarks.forEach(({ level, percentage }) => {
      const yPos = centerY - (height / 2) * percentage;
      
      // 绘制电平线
      ctx.strokeStyle = 'rgba(180, 180, 180, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, yPos);
      ctx.lineTo(x + width, yPos);
      ctx.stroke();
      
      // 绘制电平标签
      ctx.fillText(`${level} dB`, x + width + 5, yPos);
    });
    
    // 绘制下半部分电平线和标签
    levelMarks.forEach(({ level, percentage }) => {
      const yPos = centerY + (height / 2) * percentage;
      
      // 绘制电平线
      ctx.strokeStyle = 'rgba(180, 180, 180, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, yPos);
      ctx.lineTo(x + width, yPos);
      ctx.stroke();
      
      // 绘制电平标签
      ctx.fillText(`${level} dB`, x + width + 5, yPos);
    });
  };
  
  // 绘制波形数据
  const drawChannelData = (
    ctx: CanvasRenderingContext2D,
    channelData: number[],
    x: number,
    centerY: number,
    width: number,
    height: number
  ) => {
    // 创建渐变色
    const gradient = ctx.createLinearGradient(0, centerY - height / 2, 0, centerY + height / 2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, gradientColor || color);
    
    // 计算每个样本点的宽度
    const barWidth = width / channelData.length;
    
    // 设置绘图样式
    ctx.fillStyle = gradient;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    
    // 开始绘制波形路径
    ctx.beginPath();
    
    // 从左到右绘制上半部分波形
    for (let i = 0; i < channelData.length; i++) {
      const sampleX = x + i * barWidth;
      const amplitude = channelData[i] * height / 2; // 归一化振幅
      
      if (i === 0) {
        ctx.moveTo(sampleX, centerY - amplitude);
      } else {
        // 使用二次贝塞尔曲线使波形更平滑
        const prevX = x + (i - 1) * barWidth;
        const controlX = (prevX + sampleX) / 2;
        const prevY = centerY - channelData[i - 1] * height / 2;
        
        ctx.quadraticCurveTo(
          controlX, prevY,
          sampleX, centerY - amplitude
        );
      }
    }
    
    // 从右到左绘制下半部分波形
    for (let i = channelData.length - 1; i >= 0; i--) {
      const sampleX = x + i * barWidth;
      const amplitude = channelData[i] * height / 2;
      
      if (i === channelData.length - 1) {
        ctx.lineTo(sampleX, centerY + amplitude);
      } else {
        // 使用二次贝塞尔曲线使波形更平滑
        const nextX = x + (i + 1) * barWidth;
        const controlX = (nextX + sampleX) / 2;
        const nextY = centerY + channelData[i + 1] * height / 2;
        
        ctx.quadraticCurveTo(
          controlX, nextY,
          sampleX, centerY + amplitude
        );
      }
    }
    
    // 闭合路径并填充
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  
  // 使用 useEffect 监听数据变化并重绘
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);
  
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">
          Waveform
        </h3>
        {typeof data === 'object' && 'left' in data && (
          <button
            onClick={() => setShowChannels(prev => prev === 'combined' ? 'separate' : 'combined')}
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
        className="relative border border-gray-200 dark:border-gray-700 rounded-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm overflow-hidden"
      >
        <canvas 
          ref={canvasRef} 
          className="w-full h-full"
          style={{ height: `${height}px` }}
        />
      </div>
    </div>
  );
};

export default Waveform;
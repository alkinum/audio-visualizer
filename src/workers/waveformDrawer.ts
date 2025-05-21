// Waveform 绘制 Worker

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (e: MessageEvent) => {
  try {
    const { type } = e.data;

    if (type === 'canvas') {
      // 接收并存储 canvas 引用
      canvas = e.data.canvas;
      ctx = canvas.getContext('2d');
      
      if (!ctx) {
        self.postMessage({ type: 'error', message: 'Failed to get canvas context' });
        return;
      }
      
      self.postMessage({ type: 'canvasReady' });
    } else if (type === 'draw') {
      // 绘制波形
      if (!canvas || !ctx) {
        self.postMessage({ type: 'error', message: 'Canvas not initialized' });
        return;
      }
      
      drawWaveform(e.data);
      self.postMessage({ type: 'drawComplete' });
    }
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      message: error instanceof Error ? error.message : 'Unknown error in waveform worker' 
    });
  }
};

// 绘制波形图及标签
function drawWaveform({
  data, 
  width, 
  height, 
  padding, 
  color, 
  gradientColor,
  duration,
  showChannels,
  dpr
}: {
  data: any;
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  color: string;
  gradientColor: string;
  duration: number;
  showChannels: 'combined' | 'separate';
  dpr: number;
}) {
  if (!canvas || !ctx || !data) return;
  
  // 设置画布大小和缩放
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  
  // 清除画布
  ctx.clearRect(0, 0, width, height);
  
  // 可绘制区域
  const drawableWidth = width - padding.left - padding.right;
  const drawableHeight = height - padding.top - padding.bottom;
  
  // 绘制背景 - 透明
  ctx.clearRect(0, 0, width, height);
  
  // 判断是否使用分离通道模式
  const isSeparateChannelsMode = showChannels === 'separate' && typeof data === 'object' && 'left' in data;
  
  // 绘制分隔线和电平标签
  if (isSeparateChannelsMode) {
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
      drawChannelData(ctx, data.left, padding.left, ch1Center, drawableWidth, channelHeight, color, gradientColor);
      drawChannelData(ctx, data.right, padding.left, ch2Center, drawableWidth, channelHeight, color, gradientColor);
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
      drawChannelData(ctx, data.combined, padding.left, centerY, drawableWidth, drawableHeight, color, gradientColor);
    } else if (Array.isArray(data)) {
      if (Array.isArray(data[0])) {
        drawChannelData(ctx, data[0], padding.left, centerY, drawableWidth, drawableHeight, color, gradientColor);
      } else {
        drawChannelData(ctx, data as number[], padding.left, centerY, drawableWidth, drawableHeight, color, gradientColor);
      }
    }
  }
  
  // 注意：不再绘制时间指示器，这将在主线程中通过 DOM 操作处理
}

// 绘制通道背景
function drawChannelBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  // 绘制边框
  ctx.strokeStyle = 'rgba(180, 180, 180, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, width, height);
}

// 绘制电平线和标签
function drawLevelLines(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  centerY: number
) {
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
}

// 绘制波形数据
function drawChannelData(
  ctx: OffscreenCanvasRenderingContext2D,
  channelData: number[],
  x: number,
  centerY: number,
  width: number,
  height: number,
  color: string,
  gradientColor: string
) {
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
} 
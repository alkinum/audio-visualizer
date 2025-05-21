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
  
  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !containerRef.current || !data) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    const width = container.clientWidth - 64; // Account for padding and level labels
    const dpr = window.devicePixelRatio || 1;
    const effectiveHeight = showChannels === 'separate' ? height / 2 : height;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    ctx.clearRect(0, 0, width, height);
    
    const drawChannel = (channelData: number[], yOffset: number, channelHeight: number) => {
      const gradient = ctx.createLinearGradient(0, yOffset, 0, yOffset + channelHeight);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, gradientColor || color);
      
      const barWidth = width / channelData.length;
      
      ctx.fillStyle = gradient;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.moveTo(0, yOffset + channelHeight / 2);
      
      for (let i = 0; i < channelData.length; i++) {
        const x = i * barWidth;
        const amplitude = channelData[i] * channelHeight / 2;
        
        if (i === 0) {
          ctx.moveTo(x, yOffset + (channelHeight / 2) - amplitude);
        } else {
          const prevX = (i - 1) * barWidth;
          const prevAmplitude = channelData[i - 1] * channelHeight / 2;
          const cpX = (prevX + x) / 2;
          
          ctx.quadraticCurveTo(
            cpX, yOffset + (channelHeight / 2) - prevAmplitude,
            x, yOffset + (channelHeight / 2) - amplitude
          );
        }
      }
      
      for (let i = channelData.length - 1; i >= 0; i--) {
        const x = i * barWidth;
        const amplitude = channelData[i] * channelHeight / 2;
        
        if (i === channelData.length - 1) {
          ctx.lineTo(x, yOffset + (channelHeight / 2) + amplitude);
        } else {
          const nextX = (i + 1) * barWidth;
          const nextAmplitude = channelData[i + 1] * channelHeight / 2;
          const cpX = (nextX + x) / 2;
          
          ctx.quadraticCurveTo(
            cpX, yOffset + (channelHeight / 2) + nextAmplitude,
            x, yOffset + (channelHeight / 2) + amplitude
          );
        }
      }
      
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    
    // Draw level labels (dBFS)
    ctx.fillStyle = '#666666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    
    const dbLevels = [0, -6, -12, -18, -24, -30, -36, -42, -48];
    dbLevels.forEach(db => {
      const normalizedLevel = Math.pow(10, db/20); // Convert dB to linear amplitude
      const y = (1 - normalizedLevel) * effectiveHeight;
      ctx.fillText(`${db} dB`, width + 30, y + 4);
    });
    
    if (typeof data === 'object' && 'left' in data) {
      if (showChannels === 'separate') {
        drawChannel(data.left, 0, height / 2 - 10);
        drawChannel(data.right, height / 2 + 10, height / 2 - 10);
      } else {
        drawChannel(data.combined, 0, height);
      }
    } else if (Array.isArray(data)) {
      drawChannel(data, 0, height);
    }
    
    // Draw progress indicator
    if (duration > 0) {
      const progress = currentTime / duration;
      const indicatorX = width * progress;
      
      ctx.beginPath();
      ctx.moveTo(indicatorX, 0);
      ctx.lineTo(indicatorX, height);
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [data, height, color, gradientColor, currentTime, duration, showChannels]);
  
  useEffect(() => {
    drawWaveform();
    
    const handleResize = () => {
      drawWaveform();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
            className="px-3 py-1 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200"
          >
            {showChannels === 'combined' ? 'Show Channels' : 'Combine Channels'}
          </button>
        )}
      </div>
      <div ref={containerRef} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
        <canvas 
          ref={canvasRef} 
          className="w-full"
          height={height}
        />
      </div>
    </div>
  );
};

export default Waveform;
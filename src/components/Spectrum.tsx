import React, { useRef, useEffect, useState } from 'react';
import { VisualizationProps } from '../types/audio';

const Spectrum: React.FC<VisualizationProps> = ({ 
  data, 
  height = 200,
  currentTime = 0,
  duration = 0
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [spectrumHistory, setSpectrumHistory] = useState<number[][]>([]);
  
  useEffect(() => {
    if (Array.isArray(data)) {
      setSpectrumHistory(prev => {
        const newHistory = [...prev, data];
        // Keep last 100 frames
        return newHistory.slice(-100);
      });
    }
  }, [data]);

  const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000];
  
  return (
    <div className="w-full">
      <h3 className="text-lg font-bold mb-2 text-gray-800 dark:text-gray-200">
        Frequency Spectrum
      </h3>
      <div 
        ref={containerRef} 
        className="relative border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm"
      >
        <div className="w-full" style={{ height: `${height}px` }}>
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${containerRef.current?.clientWidth || 1000} ${height}`}
            preserveAspectRatio="none"
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="spectrumGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#000033" />
                <stop offset="20%" stopColor="#000066" />
                <stop offset="40%" stopColor="#660000" />
                <stop offset="60%" stopColor="#FF3300" />
                <stop offset="80%" stopColor="#FFCC00" />
                <stop offset="100%" stopColor="#FFFF00" />
              </linearGradient>
            </defs>

            {/* Frequency labels */}
            {freqLabels.map((freq, i) => {
              const x = (Math.log2(freq / 20) / Math.log2(16000 / 20)) * 100;
              return (
                <text
                  key={`freq-${freq}`}
                  x={`${x}%`}
                  y={height + 20}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="monospace"
                  fill="currentColor"
                  fillOpacity={0.5}
                >
                  {freq < 1000 ? `${freq}Hz` : `${freq/1000}kHz`}
                </text>
              );
            })}

            {/* Spectrum history visualization */}
            {spectrumHistory.map((spectrum, timeIndex) => {
              const y = (timeIndex / spectrumHistory.length) * height;
              
              return (
                <g key={`time-${timeIndex}`}>
                  {spectrum.map((value, freqIndex) => {
                    const freqPercent = (freqIndex / spectrum.length) * 100;
                    const intensity = Math.pow(value, 0.7);
                    
                    return (
                      <line
                        key={`freq-${freqIndex}`}
                        x1={`${freqPercent}%`}
                        y1={y}
                        x2={`${freqPercent + (100 / spectrum.length)}%`}
                        y2={y}
                        stroke="url(#spectrumGradient)"
                        strokeWidth={height / spectrumHistory.length}
                        strokeOpacity={intensity}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* Progress indicator */}
            {duration > 0 && (
              <line
                x1={(currentTime / duration) * (containerRef.current?.clientWidth || 1000)}
                y1="0"
                x2={(currentTime / duration) * (containerRef.current?.clientWidth || 1000)}
                y2={height}
                stroke="#EF4444"
                strokeWidth={2}
              />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};

export default Spectrum;
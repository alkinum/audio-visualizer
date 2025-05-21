import React, { useEffect, useRef, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';
import { AudioPlayerState } from '../types/audio';

interface AudioPlayerProps {
  audioState: AudioPlayerState;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioState, onPlayPause, onSeek }) => {
  const playerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const inputRangeRef = useRef<HTMLInputElement>(null);
  const audioStateRef = useRef(audioState);

  // Update ref whenever props change
  useEffect(() => {
    audioStateRef.current = audioState;
  }, [audioState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Access the latest state via ref
      const { currentTime, duration } = audioStateRef.current;

      // Space bar for play/pause
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scroll
        onPlayPause();
      }

      // Left arrow key for backward (5 seconds)
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const newTime = Math.max(0, currentTime - 5);
        onSeek(newTime);
      }

      // Right arrow key for forward (5 seconds)
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        const newTime = Math.min(duration, currentTime + 5);
        onSeek(newTime);
      }
    },
    [onPlayPause, onSeek]
  ); // Only depend on the callbacks

  useEffect(() => {
    // Add keyboard event listener when component mounts
    window.addEventListener('keydown', handleKeyDown);

    // Clean up the event listener when component unmounts
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]); // Only re-add listener if handleKeyDown changes

  // Calculate thumb position
  const calculateThumbPosition = () => {
    if (audioState.duration === 0) return 0;
    const percentage = (audioState.currentTime / audioState.duration) * 100;
    return `${percentage}%`;
  };

  return (
    <div
      ref={playerRef}
      className="flex items-center space-x-4 p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700"
      tabIndex={0} // Make div focusable
    >
      <div className="relative w-10 h-10">
        <button onClick={onPlayPause} className="absolute inset-0 w-full h-full rounded-full bg-primary hover:bg-primary/90 hover:scale-105 hover:shadow-lg transition-all duration-200 group origin-center" aria-label={audioState.isPlaying ? 'Pause' : 'Play'} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">{audioState.isPlaying ? <Pause className="w-5 h-5 text-white group-hover:text-white/90" /> : <Play className="w-5 h-5 text-white group-hover:text-white/90 ml-0.5" />}</div>
      </div>
      <div className="flex-1 relative">
        {/* Custom progress bar */}
        <div ref={progressBarRef} className="w-full h-3 bg-gray-600 dark:bg-gray-700 rounded-full relative group cursor-pointer">
          {/* Filled progress */}
          <div className="absolute top-0 left-0 h-full bg-blue-500 transition-colors duration-200 rounded-full" style={{ width: `${(audioState.currentTime / audioState.duration) * 100}%` }} />

          {/* Custom thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-blue-400 group-hover:bg-blue-300 transition-colors duration-200 rounded-full shadow-md"
            style={{
              left: calculateThumbPosition(),
              transform: 'translateX(-50%) translateY(-50%)',
              pointerEvents: 'none', // Don't interfere with input events
            }}
          />

          {/* Invisible input for interaction */}
          <input ref={inputRangeRef} type="range" min="0" max={audioState.duration} value={audioState.currentTime} onChange={(e) => onSeek(Number(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </div>
      </div>

      <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
        {formatTime(audioState.currentTime)} / {formatTime(audioState.duration)}
      </div>
    </div>
  );
};

export default AudioPlayer;

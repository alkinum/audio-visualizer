import React from 'react';
import { Play, Pause } from 'lucide-react';
import { AudioPlayerState } from '../types/audio';

interface AudioPlayerProps {
  audioState: AudioPlayerState;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioState, onPlayPause, onSeek }) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center space-x-4 p-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        onClick={onPlayPause}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-primary hover:bg-primary-light dark:bg-primary-dark dark:hover:bg-primary transition-colors"
      >
        {audioState.isPlaying ? (
          <Pause className="w-5 h-5 text-white" />
        ) : (
          <Play className="w-5 h-5 text-white" />
        )}
      </button>
      
      <div className="flex-1">
        <input
          type="range"
          min="0"
          max={audioState.duration}
          value={audioState.currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer"
          style={{
            backgroundImage: `linear-gradient(to right, var(--tw-gradient-from) 0%, var(--tw-gradient-to) ${(audioState.currentTime / audioState.duration) * 100}%, transparent ${(audioState.currentTime / audioState.duration) * 100}%)`
          }}
        />
      </div>
      
      <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
        {formatTime(audioState.currentTime)} / {formatTime(audioState.duration)}
      </div>
    </div>
  );
};

export default AudioPlayer;
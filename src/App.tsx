import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Music, Moon, Sun } from 'lucide-react';
import FileDropzone from './components/FileDropzone';
import Waveform from './components/Waveform';
import Spectrum from './components/Spectrum';
import AudioPlayer from './components/AudioPlayer';
import { processAudioFile } from './utils/audioProcessor';
import { AudioData, AudioPlayerState } from './types/audio';

function App() {
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  
  const [audioState, setAudioState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0
  });
  
  const audioContext = useRef<AudioContext | null>(null);
  const audioSource = useRef<AudioBufferSourceNode | null>(null);
  const startTime = useRef<number>(0);
  const pauseTime = useRef<number>(0);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };
  
  const handleFileSelect = useCallback(async (file: File) => {
    setIsLoading(true);
    setSelectedFile(file);
    setError(null);
    
    try {
      const data = await processAudioFile(file);
      setAudioData(data);
      setAudioState(prev => ({ ...prev, duration: data.audioBuffer.duration }));
    } catch (err) {
      console.error('Error processing audio file:', err);
      setError('Could not process this audio file. Please try a different one.');
      setAudioData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const handlePlayPause = useCallback(() => {
    if (!audioData) return;
    
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioState.isPlaying) {
      audioSource.current?.stop();
      audioSource.current = null;
      pauseTime.current = audioContext.current.currentTime - startTime.current;
      setAudioState(prev => ({ ...prev, isPlaying: false }));
    } else {
      audioSource.current = audioContext.current.createBufferSource();
      audioSource.current.buffer = audioData.audioBuffer;
      audioSource.current.connect(audioContext.current.destination);
      
      startTime.current = audioContext.current.currentTime - pauseTime.current;
      audioSource.current.start(0, pauseTime.current);
      
      setAudioState(prev => ({ ...prev, isPlaying: true }));
    }
  }, [audioData, audioState.isPlaying]);
  
  const handleSeek = useCallback((time: number) => {
    if (!audioData) return;
    
    if (audioSource.current) {
      audioSource.current.stop();
      audioSource.current = null;
    }
    
    pauseTime.current = time;
    setAudioState(prev => ({ ...prev, currentTime: time }));
    
    if (audioState.isPlaying) {
      handlePlayPause();
      handlePlayPause();
    }
  }, [audioData, audioState.isPlaying, handlePlayPause]);
  
  useEffect(() => {
    let animationFrame: number;
    
    const updateTime = () => {
      if (audioState.isPlaying && audioContext.current) {
        const currentTime = audioContext.current.currentTime - startTime.current;
        
        if (currentTime >= audioState.duration) {
          handlePlayPause();
          setAudioState(prev => ({ ...prev, currentTime: 0 }));
          pauseTime.current = 0;
        } else {
          setAudioState(prev => ({ ...prev, currentTime }));
        }
      }
      
      animationFrame = requestAnimationFrame(updateTime);
    };
    
    animationFrame = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(animationFrame);
  }, [audioState.isPlaying, audioState.duration, handlePlayPause]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 transition-colors duration-300">
      <header className="py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-light to-secondary rounded-lg blur opacity-50"></div>
              <div className="relative bg-gradient-to-r from-primary to-secondary rounded-lg p-2">
                <Music className="w-4 h-4 text-white" />
              </div>
            </div>
            <h1 className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
              Audio Visualizer
            </h1>
          </div>
          <button
            onClick={toggleDarkMode}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 dark:bg-gray-800/50 dark:hover:bg-gray-700/50 backdrop-blur-sm transition-colors duration-200 shadow-sm"
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? (
              <Sun className="w-4 h-4 text-yellow-500" />
            ) : (
              <Moon className="w-4 h-4 text-gray-600" />
            )}
          </button>
        </div>
      </header>
      
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-lg rounded-2xl shadow-xl overflow-hidden p-6 transition-colors duration-300">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            Select an Audio File
          </h2>
          
          <FileDropzone 
            onFileSelect={handleFileSelect} 
            isLoading={isLoading}
            isDarkMode={isDarkMode}
          />
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          
          {selectedFile && !isLoading && !error && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-700 dark:text-blue-400 flex items-center">
              <Music className="h-5 w-5 mr-2" />
              <span className="font-medium">{selectedFile.name}</span>
              <span className="ml-2 text-sm opacity-75">
                ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
            </div>
          )}
          
          {audioData && (
            <div className="mt-8 space-y-8 animate-fadeIn">
              <AudioPlayer 
                audioState={audioState}
                onPlayPause={handlePlayPause}
                onSeek={handleSeek}
              />
              
              <Waveform 
                data={audioData.waveformData} 
                height={160}
                color={isDarkMode ? '#60A5FA' : '#3B82F6'}
                gradientColor={isDarkMode ? '#2563EB' : '#93C5FD'}
                currentTime={audioState.currentTime}
                duration={audioState.duration}
              />
              
              <Spectrum 
                data={audioData.spectrumData} 
                height={200}
                color={isDarkMode ? '#22D3EE' : '#06B6D4'}
                gradientColor={isDarkMode ? '#0891B2' : '#67E8F9'}
                currentTime={audioState.currentTime}
                duration={audioState.duration}
              />
            </div>
          )}
        </div>
      </main>
      
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center">
        <span className="text-sm text-gray-500/50 dark:text-gray-400/50">
          Made by Alkinum
        </span>
      </footer>
    </div>
  );
}

export default App;
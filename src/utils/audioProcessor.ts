import { AudioData } from '../types/audio';

export const processAudioFile = async (file: File): Promise<AudioData> => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const waveformData = extractWaveformData(audioBuffer);
  const spectrumData = await extractSpectrumData(audioBuffer);
  
  return {
    audioBuffer,
    waveformData,
    spectrumData
  };
};

const extractWaveformData = (audioBuffer: AudioBuffer) => {
  const length = audioBuffer.length;
  const sampleSize = Math.max(1, Math.floor(length / 1000));
  const channels = audioBuffer.numberOfChannels;
  
  const leftData = new Array(1000).fill(0);
  const rightData = new Array(1000).fill(0);
  const combinedData = new Array(1000).fill(0);
  
  for (let i = 0; i < 1000; i++) {
    const startSample = i * sampleSize;
    const endSample = Math.min(startSample + sampleSize, length);
    
    let leftPeak = 0;
    let rightPeak = 0;
    
    const leftChannel = audioBuffer.getChannelData(0);
    for (let j = startSample; j < endSample; j++) {
      const amplitude = Math.abs(leftChannel[j]);
      if (amplitude > leftPeak) leftPeak = amplitude;
    }
    leftData[i] = leftPeak;
    
    if (channels > 1) {
      const rightChannel = audioBuffer.getChannelData(1);
      for (let j = startSample; j < endSample; j++) {
        const amplitude = Math.abs(rightChannel[j]);
        if (amplitude > rightPeak) rightPeak = amplitude;
      }
      rightData[i] = rightPeak;
    } else {
      rightData[i] = leftPeak;
    }
    
    combinedData[i] = (leftPeak + (channels > 1 ? rightPeak : leftPeak)) / 2;
  }
  
  return { left: leftData, right: rightData, combined: combinedData };
};

const extractSpectrumData = async (audioBuffer: AudioBuffer): Promise<number[]> => {
  const offlineContext = new OfflineAudioContext({
    numberOfChannels: audioBuffer.numberOfChannels,
    length: audioBuffer.length,
    sampleRate: audioBuffer.sampleRate
  });
  
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  
  const analyzer = offlineContext.createAnalyser();
  analyzer.fftSize = 2048;
  analyzer.smoothingTimeConstant = 0.8;
  
  source.connect(analyzer);
  analyzer.connect(offlineContext.destination);
  
  source.start(0);
  await offlineContext.startRendering();
  
  const frequencyData = new Float32Array(analyzer.frequencyBinCount);
  analyzer.getFloatFrequencyData(frequencyData);
  
  // Convert to normalized amplitude values (0-1)
  const normalizedData = new Array(256).fill(0);
  const minDb = -100;
  const maxDb = -30;
  
  for (let i = 0; i < normalizedData.length; i++) {
    const freqIndex = Math.floor((i / normalizedData.length) * (frequencyData.length * 0.75)); // Only use up to 16kHz
    const db = frequencyData[freqIndex];
    const normalized = (db - minDb) / (maxDb - minDb);
    normalizedData[i] = Math.max(0, Math.min(1, normalized));
  }
  
  return normalizedData;
};
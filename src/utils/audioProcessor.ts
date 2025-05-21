import { AudioData } from '../types/audio';

// 创建Worker的函数，确保在运行时加载而不是编译时
function createSpectrumWorker() {
  return new Worker(new URL('./spectrumWorker.ts', import.meta.url), { type: 'module' });
}

export interface SpectrumAnalysisProgress {
  progress: number; // 0-100
  currentSlice: number;
  totalSlices: number;
  partialData?: number[][];
}

export const processAudioFile = async (
  file: File,
  onProgress?: (progress: SpectrumAnalysisProgress) => void
): Promise<AudioData> => {
  const audioContext = new window.AudioContext();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 立即提取波形数据，这个操作相对较快
    const waveformData = extractWaveformData(audioBuffer);

    // 频谱分析是计算密集型操作，使用WebWorker进行异步处理
    const spectrumData = await analyzeSpectrumWithWorker(
      audioBuffer,
      onProgress
    );

    return {
      audioBuffer,
      waveformData,
      spectrumData
    };
  } finally {
    await audioContext.close().catch(console.error);
  }
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

/**
 * 使用WebWorker分析音频频谱
 * @param audioBuffer 音频缓冲区
 * @param onProgress 进度回调函数
 */
const analyzeSpectrumWithWorker = (
  audioBuffer: AudioBuffer,
  onProgress?: (progress: SpectrumAnalysisProgress) => void
): Promise<number[][]> => {
  return new Promise((resolve, reject) => {
    try {
      const worker = createSpectrumWorker();

      // 提取所有通道的音频数据
      const audioChannelData: Float32Array[] = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        audioChannelData.push(audioBuffer.getChannelData(i));
      }

      // 监听Worker消息
      worker.addEventListener('message', (e) => {
        const data = e.data;

        if (data.type === 'progress') {
          // 调用进度回调函数
          if (onProgress) {
            onProgress({
              progress: data.progress,
              currentSlice: data.currentSlice,
              totalSlices: data.totalSlices,
              partialData: data.partialResult
            });
          }
        }
        else if (data.type === 'result') {
          resolve(data.spectrumData);
          worker.terminate(); // 释放Worker资源
        }
        else if (data.type === 'error') {
          console.error('Worker error:', data.error);
          reject(new Error(data.error));
          worker.terminate();
        }
      });

      // 监听Worker错误
      worker.addEventListener('error', (error) => {
        console.error('Worker error event:', error);
        reject(error);
        worker.terminate();
      });

      // 发送数据到Worker
      worker.postMessage({
        type: 'analyzeSpectrum',
        audioData: audioChannelData,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
        timeSlice: 0.05, // 100ms 时间片段
        channels: audioBuffer.numberOfChannels
      });

    } catch (error) {
      console.error("Error setting up WebWorker:", error);
      reject(error);
    }
  });
};
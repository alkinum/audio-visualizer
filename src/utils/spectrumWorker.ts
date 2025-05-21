// 频谱分析WebWorker
// 此文件将被主线程加载为WebWorker
// 注意: 由于WebWorker环境限制，我们需要内联FFT实现，而不是从外部导入

// 定义消息类型
interface SpectrumWorkerRequest {
  type: 'analyzeSpectrum';
  audioData: Float32Array[];
  sampleRate: number;
  duration: number;
  timeSlice: number; // 单位：秒
  channels: number;
}

interface ProgressMessage {
  type: 'progress';
  progress: number; // 0-100
  currentSlice: number;
  totalSlices: number;
  partialResult?: number[][]; // 已经分析的部分结果
}

interface ResultMessage {
  type: 'result';
  spectrumData: number[][];
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

// 内联FFT实现 (为了在Worker环境中使用)
/**
 * 计算复数的幅度
 */
function magnitude(real: number, imag: number): number {
  return Math.sqrt(real * real + imag * imag);
}

/**
 * 对2的幂次方长度的数组执行FFT
 * @param signal 输入信号(需要是2的幂次方长度)
 * @returns FFT结果的幅度值
 */
function computeFFT(signal: Float32Array): number[] {
  const n = signal.length;
  
  // 确保输入长度是2的幂次方
  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT size must be a power of 2');
  }
  
  // 创建实部和虚部数组
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  
  // 复制输入信号到实部数组
  for (let i = 0; i < n; i++) {
    real[i] = signal[i];
  }
  
  // 执行FFT 
  performFFT(real, imag, n);
  
  // 计算幅度
  const magnitudes = new Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    magnitudes[i] = magnitude(real[i], imag[i]) / n;
  }
  
  return magnitudes;
}

/**
 * 执行原地FFT - 实部和虚部数组会被直接修改
 */
function performFFT(real: Float32Array, imag: Float32Array, n: number): void {
  // 位反转排序
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      // 交换实部
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;
      
      // 交换虚部
      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
    
    let k = n / 2;
    while (k <= j) {
      j -= k;
      k /= 2;
    }
    j += k;
  }
  
  // 蝶形运算
  const PI2 = Math.PI * 2;
  for (let m = 2; m <= n; m *= 2) {
    const mHalf = m / 2;
    for (let i = 0; i < n; i += m) {
      for (let j = 0; j < mHalf; j++) {
        const θ = -PI2 * j / m;
        const cosθ = Math.cos(θ);
        const sinθ = Math.sin(θ);
        
        const idx1 = i + j;
        const idx2 = idx1 + mHalf;
        
        const tReal = real[idx2] * cosθ - imag[idx2] * sinθ;
        const tImag = real[idx2] * sinθ + imag[idx2] * cosθ;
        
        real[idx2] = real[idx1] - tReal;
        imag[idx2] = imag[idx1] - tImag;
        real[idx1] += tReal;
        imag[idx1] += tImag;
      }
    }
  }
}

/**
 * 应用汉宁窗口函数到信号
 * 窗口函数可以减少频谱泄漏
 */
function applyHannWindow(signal: Float32Array): Float32Array {
  const n = signal.length;
  const result = new Float32Array(n);
  
  for (let i = 0; i < n; i++) {
    // 汉宁窗: 0.5 * (1 - cos(2π * i / (n-1)))
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    result[i] = signal[i] * window;
  }
  
  return result;
}

// 监听来自主线程的消息
self.addEventListener('message', async (e: MessageEvent<SpectrumWorkerRequest>) => {
  const { type, audioData, sampleRate, duration, timeSlice, channels } = e.data;
  
  if (type === 'analyzeSpectrum') {
    try {
      await analyzeSpectrum(audioData, sampleRate, duration, timeSlice, channels);
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      } as ErrorMessage);
    }
  }
});

/**
 * 分析音频频谱数据并通过消息发送结果和进度
 */
async function analyzeSpectrum(
  audioData: Float32Array[],
  sampleRate: number, 
  duration: number,
  timeSlice: number,
  channels: number
): Promise<void> {
  // 计算总时间片段数
  const numSlices = Math.ceil(duration / timeSlice);
  console.log(`[Worker] Analyzing audio spectrum with ${numSlices} time slices of ${timeSlice * 1000}ms each`);
  
  // 创建结果数组
  const spectrumData: number[][] = [];
  
  // 计算每个时间片段中的样本数量
  const samplesPerSlice = Math.floor(sampleRate * timeSlice);
  
  // 计算最接近的2的幂次方FFT大小
  const fftSize = 2048; // 通常使用2048点FFT
  
  // 每分析10个片段报告一次进度
  const progressInterval = Math.max(1, Math.floor(numSlices / 20));
  
  // 分析每个时间片段
  for (let sliceIndex = 0; sliceIndex < numSlices; sliceIndex++) {
    const startSample = sliceIndex * samplesPerSlice;
    const endSample = Math.min(startSample + samplesPerSlice, audioData[0].length);
    
    if (endSample <= startSample) {
      break; // 处理完音频文件
    }
    
    // 提取当前时间片段的数据
    const sliceChannelData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      sliceChannelData.push(audioData[c].slice(startSample, endSample));
    }
    
    // 分析当前时间片段
    const sliceSpectrumData = analyzeAudioSlice(sliceChannelData, sampleRate, fftSize);
    spectrumData.push(sliceSpectrumData);
    
    // 发送进度更新
    const progress = Math.round((sliceIndex + 1) / numSlices * 100);
    
    // 每处理一定数量的片段发送一次进度更新和部分结果
    if (sliceIndex % progressInterval === 0 || sliceIndex === numSlices - 1) {
      self.postMessage({
        type: 'progress',
        progress,
        currentSlice: sliceIndex + 1,
        totalSlices: numSlices,
        partialResult: spectrumData.slice() // 发送当前已处理的结果副本
      } as ProgressMessage);
    }
    
    // 每处理50个片段让出一次主线程，防止worker长时间运行导致浏览器卡顿
    if (sliceIndex % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  // 发送最终结果
  self.postMessage({
    type: 'result',
    spectrumData
  } as ResultMessage);
}

/**
 * 分析单个时间片段的频谱
 * 使用自定义FFT实现而非Web Audio API
 */
function analyzeAudioSlice(
  channelData: Float32Array[], 
  sampleRate: number,
  fftSize: number
): number[] {
  try {
    // 合并所有通道
    let combinedChannelData: Float32Array;
    if (channelData.length > 1) {
      // 如果有多个通道（如立体声），将它们合并
      combinedChannelData = new Float32Array(channelData[0].length);
      for (let i = 0; i < combinedChannelData.length; i++) {
        let sum = 0;
        for (let c = 0; c < channelData.length; c++) {
          sum += channelData[c][i];
        }
        combinedChannelData[i] = sum / channelData.length;
      }
    } else {
      // 单声道直接使用
      combinedChannelData = channelData[0];
    }

    // 提取数据集用于FFT计算，确保长度是2的幂次方
    // 如果音频片段长度不足，我们用零填充；如果超出，我们只取前面的部分
    const dataForFFT = new Float32Array(fftSize);
    
    // 复制数据并应用填充或截断
    const copyLength = Math.min(combinedChannelData.length, fftSize);
    for (let i = 0; i < copyLength; i++) {
      dataForFFT[i] = combinedChannelData[i];
    }
    
    // 应用窗口函数以减少频谱泄漏
    const windowedData = applyHannWindow(dataForFFT);
    
    // 计算FFT
    const magnitudes = computeFFT(windowedData);
    
    // 对FFT结果应用频率权重以更好地反映人类听觉
    // 人耳对低频和高频的敏感度较低，对中频敏感度较高
    const weightedMagnitudes = new Array(magnitudes.length);
    
    // 获取每个FFT bin对应的实际频率
    const nyquistFreq = sampleRate / 2;
    
    // 应用权重以平衡频率分布
    for (let i = 0; i < magnitudes.length; i++) {
      // 计算当前bin的中心频率
      const freq = (i * nyquistFreq) / magnitudes.length;
      
      // 应用A加权曲线的近似值，增强中频段的表现
      let weight = 1.0;
      
      // 对非常低的频率进行轻微抑制
      if (freq < 50) {
        weight = 0.2 + (freq / 50) * 0.8; // 20Hz仅有20%权重，逐渐增加到50Hz的100%
      }
      
      // 对高频进行轻微增强以提高可视性
      if (freq > 8000) {
        weight = 1.0 + (freq - 8000) / 8000; // 8kHz以上逐渐增加权重
      }
      
      weightedMagnitudes[i] = magnitudes[i] * weight;
    }
    
    // 应用对数压缩以更好地显示动态范围
    // 人耳感知是对数的，这样可以增强较小信号的可视性
    const logMagnitudes = weightedMagnitudes.map(mag => 
      mag > 0 ? Math.log10(1 + mag * 9) : 0
    );
    
    // 分段归一化，确保低频和高频都有合理的显示量级
    // 将频谱分为多个频段，每个频段单独归一化
    const numBands = 4; // 分为4个频段
    const bandSize = Math.ceil(logMagnitudes.length / numBands);
    
    const normalizedData = new Array(logMagnitudes.length).fill(0);
    
    // 对每个频段单独归一化
    for (let band = 0; band < numBands; band++) {
      const start = band * bandSize;
      const end = Math.min(start + bandSize, logMagnitudes.length);
      
      // 找出当前频段的最大值
      let maxVal = 0.001; // 避免除以零
      for (let i = start; i < end; i++) {
        maxVal = Math.max(maxVal, logMagnitudes[i]);
      }
      
      // 归一化当前频段
      for (let i = start; i < end; i++) {
        normalizedData[i] = Math.min(1, logMagnitudes[i] / maxVal);
      }
    }
    
    return normalizedData;
  } catch (error) {
    console.error("[Worker] Error analyzing audio slice:", error);
    // 发生错误时返回空数组
    return new Array(fftSize / 2).fill(0);
  }
}

export {}; // 确保TypeScript将此文件视为模块 
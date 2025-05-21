// Worker for spectrum visualization rendering
// This worker handles the heavy computational and drawing tasks

interface ColorPoint {
  r: number;
  g: number;
  b: number;
}

interface PaddingConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface DrawSpectrumMessage {
  type: 'draw';
  spectrumData: number[][];
  width: number;
  height: number;
  dpr: number;
  duration: number;
  currentTime: number;
  padding: PaddingConfig;
  freqLabels: number[];
}

interface CanvasTransferMessage {
  type: 'canvas';
  canvas: OffscreenCanvas;
}

type WorkerMessage = DrawSpectrumMessage | CanvasTransferMessage;

// Store the canvas and context reference
let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

// Handler for messages from the main thread
self.onmessage = (event: MessageEvent) => {
  const data = event.data as WorkerMessage;
  
  if (data.type === 'canvas') {
    // Store the transferred canvas
    offscreenCanvas = data.canvas;
    ctx = offscreenCanvas.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D;
    
    // Notify the main thread that we received the canvas
    self.postMessage({ type: 'canvasReady' });
  }
  else if (data.type === 'draw') {
    // Check if we have a canvas to draw on
    if (!offscreenCanvas || !ctx) {
      self.postMessage({ 
        type: 'error',
        message: 'No canvas available. Please transfer a canvas first.'
      });
      return;
    }
    
    // Draw the spectrum
    drawSpectrum(data);
  }
};

// Calculate logarithmic frequency position
function getFrequencyY(freq: number, drawHeight: number, padding: PaddingConfig): number {
  // Enhanced logarithmic scaling for low-frequency domain
  const logMin = Math.log10(20); // Minimum frequency 20Hz
  const logMax = Math.log10(16000); // Maximum frequency 16kHz
  
  // Enhanced logarithm to emphasize low-frequency area
  const enhancedLog = Math.log10(freq);
  // Note: Using 1 minus ratio means low frequencies (small values) map to bottom of canvas (large y values)
  const yRatio = 1 - (enhancedLog - logMin) / (logMax - logMin);
  
  return padding.top + yRatio * (drawHeight - padding.top - padding.bottom);
}

// Get color based on signal strength
function getSignalColor(magnitude: number): string {
  // Map absolute signal value to 0-1 range for color mapping
  // Based on experience, logarithmic intensity values typically range from 0 to 0.3
  const normalizedMagnitude = Math.min(1, magnitude / 0.3);
  
  // Color definitions
  const colors = {
    low: { r: 59, g: 7, b: 100 },         // Deep purple #3B0764
    mediumLow: { r: 126, g: 34, b: 206 }, // Purple #7E22CE
    medium: { r: 219, g: 39, b: 119 },    // Pink #DB2777
    mediumHigh: { r: 225, g: 29, b: 72 }, // Red #E11D48
    high: { r: 249, g: 115, b: 22 }       // Orange #F97316
  };
  
  // Interpolate colors based on mapped signal strength
  let r, g, b;
  
  if (normalizedMagnitude < 0.25) {
    // From deep purple to purple
    const t = normalizedMagnitude / 0.25;
    r = Math.round(colors.low.r + t * (colors.mediumLow.r - colors.low.r));
    g = Math.round(colors.low.g + t * (colors.mediumLow.g - colors.low.g));
    b = Math.round(colors.low.b + t * (colors.mediumLow.b - colors.low.b));
  } else if (normalizedMagnitude < 0.5) {
    // From purple to pink
    const t = (normalizedMagnitude - 0.25) / 0.25;
    r = Math.round(colors.mediumLow.r + t * (colors.medium.r - colors.mediumLow.r));
    g = Math.round(colors.mediumLow.g + t * (colors.medium.g - colors.mediumLow.g));
    b = Math.round(colors.mediumLow.b + t * (colors.medium.b - colors.mediumLow.b));
  } else if (normalizedMagnitude < 0.75) {
    // From pink to red
    const t = (normalizedMagnitude - 0.5) / 0.25;
    r = Math.round(colors.medium.r + t * (colors.mediumHigh.r - colors.medium.r));
    g = Math.round(colors.medium.g + t * (colors.mediumHigh.g - colors.medium.g));
    b = Math.round(colors.medium.b + t * (colors.medium.b - colors.medium.b));
  } else {
    // From red to orange
    const t = (normalizedMagnitude - 0.75) / 0.25;
    r = Math.round(colors.mediumHigh.r + t * (colors.high.r - colors.mediumHigh.r));
    g = Math.round(colors.mediumHigh.g + t * (colors.high.g - colors.mediumHigh.g));
    b = Math.round(colors.mediumHigh.b + t * (colors.high.b - colors.mediumHigh.b));
  }
  
  return `rgb(${r}, ${g}, ${b})`;
}

// Format seconds to mm:ss
function formatTimeToMMSS(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Main drawing function
function drawSpectrum(data: DrawSpectrumMessage): void {
  if (!ctx || !offscreenCanvas || !data.spectrumData.length) return;

  const { 
    width, 
    height, 
    dpr, 
    duration, 
    padding, 
    freqLabels, 
    spectrumData 
  } = data;

  // Get container width with space for labels
  const drawWidth = width - padding.right;
  const canvasHeight = height;

  // Adjust canvas size for device pixel ratio
  offscreenCanvas.width = width * dpr;
  offscreenCanvas.height = canvasHeight * dpr;

  // Apply DPI scaling
  ctx.scale(dpr, dpr);

  // Clear the canvas
  ctx.clearRect(0, 0, width, canvasHeight);

  // Calculate drawable area
  const drawHeight = canvasHeight - padding.top - padding.bottom;

  // Draw background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(padding.left, padding.top, drawWidth, drawHeight);

  // Draw border
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padding.left, padding.top, drawWidth, drawHeight);

  // Draw frequency grid lines
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)';
  ctx.lineWidth = 1;

  // Draw frequency labels and grid lines
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
  ctx.textAlign = 'left';

  freqLabels.forEach((freq) => {
    const yPos = getFrequencyY(freq, canvasHeight, padding);

    // Draw grid line
    ctx.beginPath();
    ctx.moveTo(padding.left, yPos);
    ctx.lineTo(padding.left + drawWidth, yPos);
    ctx.stroke();

    // Draw frequency label (right side)
    const label = freq < 1000 ? `${freq}Hz` : `${freq / 1000}kHz`;
    ctx.fillText(label, padding.left + drawWidth + 5, yPos);
  });

  // Handle empty data case
  if (spectrumData.length === 0) {
    self.postMessage({ type: 'drawComplete' });
    return;
  }

  // Calculate time axis scaling factor
  const timeBarWidth = drawWidth / spectrumData.length;

  // Draw time axis ticks and labels
  const timeIntervals = Math.min(10, spectrumData.length);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i <= timeIntervals; i++) {
    const ratio = i / timeIntervals;
    const xPos = padding.left + ratio * drawWidth;
    const timeValue = ratio * duration;

    // Draw time tick line
    ctx.beginPath();
    ctx.moveTo(xPos, canvasHeight - padding.bottom);
    ctx.lineTo(xPos, canvasHeight - padding.bottom + 5);
    ctx.stroke();

    // Draw time label in mm:ss format
    ctx.fillText(formatTimeToMMSS(timeValue), xPos, canvasHeight - padding.bottom + 8);
  }

  // Draw spectrum data
  // In FFT result array, index 0 is DC component (0Hz), higher index = higher frequency
  for (let timeIdx = 0; timeIdx < spectrumData.length; timeIdx++) {
    const timeSlice = spectrumData[timeIdx];
    if (!timeSlice || timeSlice.length === 0) continue;

    // Calculate time slice X coordinate
    const xPos = padding.left + timeIdx * timeBarWidth;

    // Draw each frequency block
    for (let freqIdx = 0; freqIdx < timeSlice.length; freqIdx++) {
      const magnitude = timeSlice[freqIdx];

      // Use lower visibility threshold to make more signals visible
      if (magnitude < 0.001) continue;

      // Calculate current frequency block's proportional position in total frequency range
      // Correctly map frequency index to actual frequency (using FFT principles)
      const nyquistFreq = 22050; // Corrected to standard 44.1kHz sampling rate half
      const binCount = timeSlice.length; // Usually 1024 or 2048

      // Calculate actual frequency corresponding to this block, maintaining low index = low freq, high index = high freq
      const startFreq = Math.max(20, (freqIdx * nyquistFreq) / binCount);
      const endFreq = Math.max(20, ((freqIdx + 1) * nyquistFreq) / binCount);

      // Log-scaled Y coordinates, ensuring low-frequency regions have reasonable visual space
      const yStart = getFrequencyY(startFreq, canvasHeight, padding);
      const yEnd = getFrequencyY(endFreq, canvasHeight, padding);

      // Calculate rectangle height (ensure at least 1 pixel)
      const rectHeight = Math.max(1, yStart - yEnd);

      // Use signal strength to determine both color and transparency
      ctx.fillStyle = getSignalColor(magnitude);

      // Set transparency based on absolute signal strength
      // Log-processed signals usually range from 0-0.3, map to 0.05-1.0 alpha range
      const alpha = 0.05 + Math.min(0.95, magnitude * 3.5);
      ctx.globalAlpha = alpha;

      // Draw rectangle - starting point is higher frequency (lower Y), drawing down to lower frequency (higher Y)
      ctx.fillRect(xPos, yEnd, timeBarWidth, rectHeight);
    }
  }

  // Reset transparency
  ctx.globalAlpha = 1.0;

  // Notify main thread that drawing is complete
  self.postMessage({ type: 'drawComplete' });
} 
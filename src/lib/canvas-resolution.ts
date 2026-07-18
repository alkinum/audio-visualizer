export function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): CanvasRenderingContext2D | null {
  const pixelWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(pixelWidth / cssWidth, 0, 0, pixelHeight / cssHeight, 0, 0);
  return context;
}

export function observeDevicePixelRatio(onChange: (ratio: number) => void): () => void {
  let ratio = window.devicePixelRatio || 1;
  let mediaQuery: MediaQueryList | null = null;

  const update = () => {
    const nextRatio = window.devicePixelRatio || 1;
    if (nextRatio === ratio && mediaQuery) return;
    ratio = nextRatio;
    mediaQuery?.removeEventListener('change', update);
    mediaQuery = window.matchMedia(`(resolution: ${ratio}dppx)`);
    mediaQuery.addEventListener('change', update);
    onChange(ratio);
  };

  window.addEventListener('resize', update);
  update();

  return () => {
    window.removeEventListener('resize', update);
    mediaQuery?.removeEventListener('change', update);
  };
}

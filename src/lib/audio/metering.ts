export function linearRmsDb(leftDb: number, rightDb: number): number {
  const left = 10 ** (leftDb / 20);
  const right = 10 ** (rightDb / 20);
  return 20 * Math.log10(Math.max(1e-7, Math.sqrt((left * left + right * right) / 2)));
}

export function calculateCorrelation(
  left: Float32Array<ArrayBufferLike>,
  right: Float32Array<ArrayBufferLike>,
): number {
  let sumProduct = 0;
  let leftPower = 0;
  let rightPower = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    sumProduct += left[index] * right[index];
    leftPower += left[index] * left[index];
    rightPower += right[index] * right[index];
  }

  return sumProduct / Math.max(1e-7, Math.sqrt(leftPower * rightPower));
}

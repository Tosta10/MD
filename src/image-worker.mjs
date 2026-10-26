import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

function decode(file, mime) {
  const bytes = fs.readFileSync(file);
  if (mime === 'image/jpeg') return jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 192, tolerantDecoding: false });
  if (mime === 'image/png') {
    if (bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16000000) throw new Error('圖片超過 1600 萬像素');
    return PNG.sync.read(bytes);
  }
  throw new Error('區域裁切與像素比較支援 PNG／JPEG；WebP 可由工作台轉成 PNG 再匯入');
}
function sample(image, rect, maxDimension) {
  const r = rect || { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.floor(r.x * image.width), y = Math.floor(r.y * image.height), width = Math.max(1, Math.round(r.width * image.width)), height = Math.max(1, Math.round(r.height * image.height));
  const ratio = Math.min(1, maxDimension / Math.max(width, height)), out = new PNG({ width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) });
  for (let j = 0; j < out.height; j++) for (let i = 0; i < out.width; i++) {
    const sx = Math.min(image.width - 1, x + Math.floor(i / ratio)), sy = Math.min(image.height - 1, y + Math.floor(j / ratio)), si = (sy * image.width + sx) * 4, di = (j * out.width + i) * 4;
    for (let c = 0; c < 4; c++) out.data[di + c] = image.data[si + c];
  }
  return out;
}
try {
  const image = decode(workerData.file, workerData.mime);
  if (workerData.compare) {
    const other = decode(workerData.compare.file, workerData.compare.mime);
    const a = sample(image, null, 256), b = sample(other, null, 256), width = Math.min(a.width, b.width), height = Math.min(a.height, b.height);
    let delta = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) delta += Math.abs(a.data[(y * a.width + x) * 4 + c] - b.data[(y * b.width + x) * 4 + c]);
    parentPort.postMessage({ meanAbsoluteDifference: delta / (width * height * 3), normalizedSimilarity: 1 - delta / (width * height * 3 * 255), sameDimensions: image.width === other.width && image.height === other.height, method: 'top-left-overlap-nearest-sample-rgb-mae', comparable: image.width * other.height === other.width * image.height, meaning: '僅像素差異，不代表功能、布局或審美品質' });
  } else {
    const out = sample(image, workerData.rect, workerData.maxDimension || 1024);
    parentPort.postMessage({ width: out.width, height: out.height, bytes: PNG.sync.write(out), mime: 'image/png', resampling: 'nearest_neighbor' });
  }
} catch (error) { parentPort.postMessage({ error: error.message }); }

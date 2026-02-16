import { loadScript, smoothstep } from './utils.js';

let segmenter = null;

async function ensureSegmenter() {
  if (segmenter) return segmenter;

  await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
  if (!window.SelfieSegmentation) {
    throw new Error('SelfieSegmentation unavailable');
  }

  segmenter = new window.SelfieSegmentation({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
  });
  segmenter.setOptions({ modelSelection: 1 });
  return segmenter;
}

export async function segmentFrame(frameCanvas) {
  const seg = await ensureSegmenter();

  let resolver;
  const done = new Promise((resolve) => {
    resolver = resolve;
  });

  seg.onResults((results) => resolver(results.segmentationMask));
  await seg.send({ image: frameCanvas });
  const rawMask = await done;

  const w = frameCanvas.width;
  const h = frameCanvas.height;
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = w;
  rawCanvas.height = h;

  const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
  rawCtx.drawImage(rawMask, 0, 0, w, h);
  const raw = rawCtx.getImageData(0, 0, w, h).data;

  const srcA = new Uint8ClampedArray(w * h);
  const eroded = new Uint8ClampedArray(w * h);
  const filtered = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let i = 0, p = 0; i < raw.length; i += 4, p += 1) {
    const prob = raw[i] / 255;
    srcA[p] = Math.round(smoothstep(0.56, 0.9, prob) * 255);
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let minA = 255;
      for (let oy = -1; oy <= 1; oy += 1) {
        const yy = Math.max(0, Math.min(h - 1, y + oy));
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = Math.max(0, Math.min(w - 1, x + ox));
          const a = srcA[yy * w + xx];
          if (a < minA) minA = a;
        }
      }
      eroded[y * w + x] = minA;
    }
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const yy = Math.max(0, Math.min(h - 1, y + oy));
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = Math.max(0, Math.min(w - 1, x + ox));
          sum += eroded[yy * w + xx];
          n += 1;
        }
      }
      const af = (sum / n) / 255;
      filtered[y * w + x] = Math.round((af >= 0.74 ? 1 : Math.pow(af, 1.18)) * 255);
    }
  }

  for (let i = 0, p = 0; i < out.length; i += 4, p += 1) {
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = filtered[p];
  }

  const matte = document.createElement('canvas');
  matte.width = w;
  matte.height = h;
  matte.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);

  const blur = document.createElement('canvas');
  blur.width = w;
  blur.height = h;
  const bctx = blur.getContext('2d');
  bctx.filter = 'blur(1.25px)';
  bctx.drawImage(matte, 0, 0);
  return blur;
}

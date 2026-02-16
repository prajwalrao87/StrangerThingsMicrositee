import { loadScript } from './utils.js';

let detector = null;

async function ensureFaceDetector() {
  if (detector) return detector;

  await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js');
  if (!window.FaceDetection) {
    throw new Error('FaceDetection unavailable');
  }

  detector = new window.FaceDetection({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
  });
  detector.setOptions({
    model: 'short',
    minDetectionConfidence: 0.5
  });
  return detector;
}

export async function detectFaceBox(imageLike, widthHint = 0, heightHint = 0) {
  const fd = await ensureFaceDetector();

  let resolver;
  const done = new Promise((resolve) => {
    resolver = resolve;
  });

  fd.onResults((results) => {
    resolver(results?.detections?.[0] || null);
  });

  await fd.send({ image: imageLike });
  const det = await done;
  if (!det) return null;

  const w = widthHint || imageLike.naturalWidth || imageLike.videoWidth || imageLike.width || 0;
  const h = heightHint || imageLike.naturalHeight || imageLike.videoHeight || imageLike.height || 0;
  if (!w || !h) return null;

  const b = det.boundingBox;
  const bw = b.width * w;
  const bh = b.height * h;
  const x = b.xCenter * w - bw / 2;
  const y = b.yCenter * h - bh / 2;

  return {
    x,
    y,
    w: bw,
    h: bh,
    cx: b.xCenter * w,
    cy: b.yCenter * h
  };
}

import { clamp, loadScript } from './utils.js';

export const OVAL_IDX = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

let faceMesh = null;

export async function ensureFaceMesh() {
  if (faceMesh) return faceMesh;

  await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
  if (!window.FaceMesh) {
    throw new Error('FaceMesh unavailable');
  }

  faceMesh = new window.FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  return faceMesh;
}

export async function detectFaceMesh(imageLike, widthHint = 0, heightHint = 0) {
  const mesh = await ensureFaceMesh();
  let resolver;
  const done = new Promise((resolve) => {
    resolver = resolve;
  });

  mesh.onResults((results) => {
    resolver(results?.multiFaceLandmarks?.[0] || null);
  });

  await mesh.send({ image: imageLike });
  const landmarks = await done;
  if (!landmarks) return null;

  const w = widthHint || imageLike.naturalWidth || imageLike.videoWidth || imageLike.width || 0;
  const h = heightHint || imageLike.naturalHeight || imageLike.videoHeight || imageLike.height || 0;
  if (!w || !h) return null;

  return { landmarks, w, h };
}

export function getPointPx(mesh, idx) {
  const p = mesh.landmarks[idx];
  return { x: p.x * mesh.w, y: p.y * mesh.h };
}

export function getLandmarkPoints(mesh, indices) {
  if (!mesh?.landmarks?.length) return [];
  const pts = [];
  for (const idx of indices) {
    const p = mesh.landmarks[idx];
    if (!p) continue;
    pts.push({ x: p.x * mesh.w, y: p.y * mesh.h });
  }
  return pts;
}

export function solveSimilarityTransform(srcPts, dstPts) {
  const n = Math.min(srcPts.length, dstPts.length);
  if (n < 3) return null;

  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < n; i += 1) {
    sx += srcPts[i].x;
    sy += srcPts[i].y;
    dx += dstPts[i].x;
    dy += dstPts[i].y;
  }

  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;

  let a = 0;
  let b = 0;
  let denom = 0;

  for (let i = 0; i < n; i += 1) {
    const xs = srcPts[i].x - sx;
    const ys = srcPts[i].y - sy;
    const xd = dstPts[i].x - dx;
    const yd = dstPts[i].y - dy;
    a += xs * xd + ys * yd;
    b += xs * yd - ys * xd;
    denom += xs * xs + ys * ys;
  }

  if (denom < 1e-6) return null;

  const scale = Math.sqrt(a * a + b * b) / denom;
  const rotation = Math.atan2(b, a);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const tx = dx - scale * (c * sx - s * sy);
  const ty = dy - scale * (s * sx + c * sy);
  return {
    scale: clamp(scale, 0.4, 2.4),
    rotation,
    tx,
    ty
  };
}

import { clamp, loadImage } from './utils.js';
import { getLandmarkPoints, OVAL_IDX, solveSimilarityTransform } from './facemesh.js';

function drawCoverWithTransform(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;

  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { scale, dx, dy };
}

function polygonMaskCanvas(w, h, points, feather = 10) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!points || points.length < 3) return c;

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fill();

  const b = document.createElement('canvas');
  b.width = w;
  b.height = h;
  const bctx = b.getContext('2d');
  bctx.filter = `blur(${Math.round(feather)}px)`;
  bctx.drawImage(c, 0, 0);
  return b;
}

function localColorMatchLayer(layerCtx, bgCtx, w, h, strength = 0.8) {
  const layer = layerCtx.getImageData(0, 0, w, h);
  const bg = bgCtx.getImageData(0, 0, w, h);
  const ld = layer.data;
  const bd = bg.data;

  let lr = 0, lg = 0, lb = 0, lrr = 0, lgg = 0, lbb = 0;
  let br = 0, bgm = 0, bb = 0, brr = 0, bgg = 0, bbb = 0;
  let n = 0;

  for (let i = 0; i < ld.length; i += 4) {
    const a = ld[i + 3] / 255;
    if (a < 0.22) continue;

    const r = ld[i], g = ld[i + 1], b = ld[i + 2];
    const rr = bd[i], gg = bd[i + 1], bbv = bd[i + 2];

    lr += r; lg += g; lb += b;
    lrr += r * r; lgg += g * g; lbb += b * b;
    br += rr; bgm += gg; bb += bbv;
    brr += rr * rr; bgg += gg * gg; bbb += bbv * bbv;
    n += 1;
  }

  if (n < 30) return;

  const lmr = lr / n, lmg = lg / n, lmb = lb / n;
  const bmr = br / n, bmg = bgm / n, bmb = bb / n;
  const lsr = Math.sqrt(Math.max(1, lrr / n - lmr * lmr));
  const lsg = Math.sqrt(Math.max(1, lgg / n - lmg * lmg));
  const lsb = Math.sqrt(Math.max(1, lbb / n - lmb * lmb));
  const bsr = Math.sqrt(Math.max(1, brr / n - bmr * bmr));
  const bsg = Math.sqrt(Math.max(1, bgg / n - bmg * bmg));
  const bsb = Math.sqrt(Math.max(1, bbb / n - bmb * bmb));

  for (let i = 0; i < ld.length; i += 4) {
    const a = ld[i + 3] / 255;
    if (a < 0.22) continue;

    const tr = ((ld[i] - lmr) * (bsr / lsr)) + bmr;
    const tg = ((ld[i + 1] - lmg) * (bsg / lsg)) + bmg;
    const tb = ((ld[i + 2] - lmb) * (bsb / lsb)) + bmb;

    ld[i] = clamp(ld[i] + (tr - ld[i]) * strength, 0, 255);
    ld[i + 1] = clamp(ld[i + 1] + (tg - ld[i + 1]) * strength, 0, 255);
    ld[i + 2] = clamp(ld[i + 2] + (tb - ld[i + 2]) * strength, 0, 255);
  }

  layerCtx.putImageData(layer, 0, 0);
}

function despillEdges(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a <= 0.001 || a >= 0.58) continue;
    const edge = (0.58 - a) / 0.58;
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const despill = edge * 0.42;
    const darken = edge * 0.18;
    d[i] = Math.max(0, d[i] * (1 - despill) + gray * despill);
    d[i + 1] = Math.max(0, d[i + 1] * (1 - despill) + gray * despill);
    d[i + 2] = Math.max(0, d[i + 2] * (1 - despill) + gray * despill);
    d[i] *= (1 - darken);
    d[i + 1] *= (1 - darken);
    d[i + 2] *= (1 - darken);
  }
  ctx.putImageData(img, 0, 0);
}

export async function renderFaceBlend({
  outCanvas,
  sceneSrc,
  frameCanvas,
  maskCanvas,
  userMesh,
  getBgMesh
}) {
  const bgImage = await loadImage(sceneSrc);
  const outW = 1280;
  const outH = 720;

  outCanvas.width = outW;
  outCanvas.height = outH;

  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  outCtx.clearRect(0, 0, outW, outH);

  const cover = drawCoverWithTransform(outCtx, bgImage, outW, outH);
  if (!cover) return;

  const bgMesh = await getBgMesh(sceneSrc, bgImage);

  const cutout = document.createElement('canvas');
  cutout.width = frameCanvas.width;
  cutout.height = frameCanvas.height;

  const cctx = cutout.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(frameCanvas, 0, 0);
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(maskCanvas, 0, 0);
  cctx.globalCompositeOperation = 'source-over';
  despillEdges(cctx, cutout.width, cutout.height);

  const layer = document.createElement('canvas');
  layer.width = outW;
  layer.height = outH;
  const lctx = layer.getContext('2d', { willReadFrequently: true });

  if (userMesh && bgMesh) {
    const fitIdx = [...OVAL_IDX, 33, 263, 1, 10, 152];
    const srcPts = getLandmarkPoints(userMesh, fitIdx);
    const dstPts = getLandmarkPoints(bgMesh, fitIdx).map((p) => ({
      x: p.x * cover.scale + cover.dx,
      y: p.y * cover.scale + cover.dy
    }));
    const fit = solveSimilarityTransform(srcPts, dstPts);

    if (fit) {
      const rot = fit.rotation;
      const sc = clamp(fit.scale * 0.98, 0.55, 1.8);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      lctx.setTransform(sc * c, sc * s, -sc * s, sc * c, fit.tx, fit.ty);
      lctx.drawImage(cutout, 0, 0);
      lctx.setTransform(1, 0, 0, 1, 0, 0);

      const region = getLandmarkPoints(bgMesh, OVAL_IDX).map((p) => ({
        x: p.x * cover.scale + cover.dx,
        y: p.y * cover.scale + cover.dy
      }));
      const regionMask = polygonMaskCanvas(outW, outH, region, 12);
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(regionMask, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
    }
  }

  localColorMatchLayer(lctx, outCtx, outW, outH, 0.8);

  outCtx.save();
  outCtx.filter = 'blur(7px)';
  outCtx.globalAlpha = 0.18;
  outCtx.globalCompositeOperation = 'multiply';
  outCtx.drawImage(layer, 4, 7);
  outCtx.restore();

  outCtx.drawImage(layer, 0, 0);
  outCtx.save();
  outCtx.globalCompositeOperation = 'soft-light';
  outCtx.globalAlpha = 0.2;
  outCtx.drawImage(layer, 0, 0);
  outCtx.restore();
}

import { segmentFrame } from './segment.js';
import { detectFaceMesh, getPointPx, OVAL_IDX } from './facemesh.js';
import { detectFaceBox } from './face.js';
import { renderFaceBlend } from './blend.js';

let arSegmenterReady = false;
const AR_DEFAULT_PREVIEW = 'assets/cast/eleven.jpg';

function getActiveSceneButton(arSceneButtons) {
  return arSceneButtons.find((button) => button.classList.contains('is-active')) || null;
}

function getActiveSceneName(arSceneButtons) {
  const activeButton = getActiveSceneButton(arSceneButtons);
  const label = activeButton?.querySelector('.ar-scene-label')?.textContent?.trim();
  return label || activeButton?.textContent?.trim() || 'Hawkins';
}

function getSceneImageSrc(arSceneButtons) {
  const activeButton = getActiveSceneButton(arSceneButtons);
  const img = activeButton?.querySelector('img');
  return img?.getAttribute('src') || null;
}

function ovalMaskFromMeshCanvas(mesh, featherPx = 8) {
  const c = document.createElement('canvas');
  c.width = mesh.w;
  c.height = mesh.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  OVAL_IDX.forEach((idx, i) => {
    const p = getPointPx(mesh, idx);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fill();

  const b = document.createElement('canvas');
  b.width = mesh.w;
  b.height = mesh.h;
  const bctx = b.getContext('2d');
  bctx.filter = `blur(${Math.round(featherPx)}px)`;
  bctx.drawImage(c, 0, 0);
  return b;
}

function multiplyMaskCanvases(maskA, maskB) {
  const w = maskA.width;
  const h = maskA.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;

  const cA = maskA.getContext('2d', { willReadFrequently: true });
  const cB = maskB.getContext('2d', { willReadFrequently: true });
  const outCtx = out.getContext('2d');
  const aData = cA.getImageData(0, 0, w, h).data;
  const bData = cB.getImageData(0, 0, w, h).data;

  const buffer = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    const aa = aData[i + 3] / 255;
    const ba = bData[i + 3] / 255;
    const v = Math.round(aa * ba * 255);
    buffer[i] = 255;
    buffer[i + 1] = 255;
    buffer[i + 2] = 255;
    buffer[i + 3] = v;
  }

  outCtx.putImageData(new ImageData(buffer, w, h), 0, 0);
  return out;
}

function applyArSceneDepth(arSceneButtons) {
  const activeIndex = arSceneButtons.findIndex((button) => button.classList.contains('is-active'));

  arSceneButtons.forEach((button, index) => {
    button.style.setProperty('--i', String(index));
    button.classList.remove('near-left', 'near-right', 'far-left', 'far-right');

    if (activeIndex < 0) {
      button.style.setProperty('--offset', '0');
      return;
    }

    const offset = index - activeIndex;
    button.style.setProperty('--offset', String(offset));

    if (offset === -1) button.classList.add('near-left');
    else if (offset === 1) button.classList.add('near-right');
    else if (offset <= -2) button.classList.add('far-left');
    else if (offset >= 2) button.classList.add('far-right');
  });
}

export function initArExperience() {
  const arLaunchBtn = document.getElementById('arLaunchBtn');
  const arCaptureWrap = document.getElementById('arCaptureWrap');
  const arCaptureVideo = document.getElementById('arCaptureVideo');
  const arBlendCanvas = document.getElementById('arBlendCanvas');
  const arCaptureBtn = document.getElementById('arCaptureBtn');
  const arCaptureCloseBtn = document.getElementById('arCaptureCloseBtn');
  const arCaptureNote = document.getElementById('arCaptureNote');
  const arSceneButtons = Array.from(document.querySelectorAll('.ar-scene'));
  const arPanel = document.querySelector('.panel-ar');
  const arStage = document.getElementById('arStage');
  const arLaunchImage = document.querySelector('#arLaunchBtn img');
  const arCaptureShell = document.querySelector('.ar-capture-shell');
  const arProcessing = document.getElementById('arProcessing');
  const arProcessingTitle = document.querySelector('#arProcessing strong');
  const arProcessingSub = document.querySelector('#arProcessing small');
  const arScenesStrip = document.querySelector('.ar-scenes');

  if (!arLaunchBtn || !arCaptureWrap || !arCaptureVideo || !arBlendCanvas || !arCaptureBtn || !arCaptureCloseBtn || !arPanel || !arCaptureShell || !arProcessing || !arCaptureNote || arSceneButtons.length === 0) {
    return;
  }

  let stream = null;
  let captureState = null;
  let blendInFlight = false;
  let stripTargetX = 0;
  let stripCurrentX = 0;
  const bgMeshCache = new Map();
  const bgFaceCache = new Map();
  const STRIP_LERP = 0.18;

  const getBgMesh = async (sceneSrc, bgImage) => {
    if (bgMeshCache.has(sceneSrc)) return bgMeshCache.get(sceneSrc);
    const mesh = await detectFaceMesh(bgImage);
    bgMeshCache.set(sceneSrc, mesh || null);
    return mesh || null;
  };

  const getBgFace = async (sceneSrc, bgImage) => {
    if (bgFaceCache.has(sceneSrc)) return bgFaceCache.get(sceneSrc);
    const face = await detectFaceBox(bgImage);
    bgFaceCache.set(sceneSrc, face || null);
    return face || null;
  };

  const animateStrip = () => {
    if (arScenesStrip) {
      stripCurrentX += (stripTargetX - stripCurrentX) * STRIP_LERP;
      arScenesStrip.style.transform = `translate3d(${stripCurrentX}px, 0, 0)`;
    }
    requestAnimationFrame(animateStrip);
  };

  const resetCaptureState = () => {
    arCaptureShell.classList.remove('is-processing', 'is-result');
    arProcessing.setAttribute('aria-hidden', 'true');
    captureState = null;
  };

  const syncStageLayout = () => {
    // Keep one fixed frame for every background scene.
    arPanel.classList.remove('is-portrait-scene');
    arPanel.style.setProperty('--ar-stage-aspect', '1280 / 1897');
  };

  const syncStagePreview = () => {
    if (!arLaunchImage) return;
    arLaunchImage.src = AR_DEFAULT_PREVIEW;
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      arCaptureNote.textContent = 'Camera is not supported in this browser.';
      return;
    }

    arCaptureNote.textContent = `Scene locked: ${getActiveSceneName(arSceneButtons)}. Capture when ready.`;
    resetCaptureState();
    arCaptureWrap.classList.add('open');
    arCaptureWrap.setAttribute('aria-hidden', 'false');
    arPanel.classList.add('is-camera-open');
    syncStageLayout();
    syncStagePreview();
    stripTargetX = 0;
    stripCurrentX = 0;
    if (arScenesStrip) {
      arScenesStrip.style.transform = 'translate3d(0, 0, 0)';
    }
    arPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (stream) {
      arCaptureVideo.srcObject = stream;
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 1.7777777778 }
        },
        audio: false
      });
      arCaptureVideo.srcObject = stream;
      await arCaptureVideo.play();
    } catch (err) {
      arCaptureWrap.classList.remove('open');
      arCaptureWrap.setAttribute('aria-hidden', 'true');
      arPanel.classList.remove('is-camera-open');
      const errName = err && typeof err === 'object' && 'name' in err ? err.name : 'UnknownError';
      arCaptureNote.textContent = `Camera access failed (${errName}). Allow camera permission and retry.`;
      console.error('Camera start failed:', err);
    }
  };

  const stopCamera = () => {
    if (document.activeElement && arCaptureWrap.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    arCaptureVideo.srcObject = null;
    arCaptureWrap.classList.remove('open');
    arCaptureWrap.setAttribute('aria-hidden', 'true');
    arPanel.classList.remove('is-camera-open');
    stripTargetX = 0;
    stripCurrentX = 0;
    if (arScenesStrip) {
      arScenesStrip.style.transform = 'translate3d(0, 0, 0)';
    }
    resetCaptureState();
    syncStagePreview();
    arLaunchBtn?.focus();
  };

  const renderCurrentBlend = async () => {
    if (!captureState) return;
    const sceneSrc = getSceneImageSrc(arSceneButtons);
    if (!sceneSrc) throw new Error('No scene selected');

    await renderFaceBlend({
      outCanvas: arBlendCanvas,
      sceneSrc,
      frameCanvas: captureState.frameCanvas,
      maskCanvas: captureState.maskCanvas,
      userMesh: captureState.userMesh,
      userFace: captureState.userFace,
      getBgMesh,
      getBgFace
    });
    syncStageLayout();
    syncStagePreview();
  };

  arLaunchBtn.addEventListener('click', () => {
    startCamera();
  });

  arCaptureCloseBtn.addEventListener('click', () => {
    stopCamera();
  });

  arCaptureBtn.addEventListener('click', async () => {
    if (blendInFlight || !stream) return;

    blendInFlight = true;
    const sceneName = getActiveSceneName(arSceneButtons);
    if (arProcessingTitle) {
      arProcessingTitle.textContent = sceneName === 'Upside Down' ? 'Opening Upside Down gate...' : 'Stabilizing portal...';
    }
    if (arProcessingSub) {
      arProcessingSub.textContent = `Binding to ${sceneName} scene`;
    }

    arCaptureShell.classList.add('is-processing');
    arCaptureShell.classList.remove('is-result');
    arProcessing.setAttribute('aria-hidden', 'false');
    arCaptureNote.textContent = 'Rift lock engaged. Processing your avatar...';

    try {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = arCaptureVideo.videoWidth || 1280;
      frameCanvas.height = arCaptureVideo.videoHeight || 720;
      const fctx = frameCanvas.getContext('2d');
      fctx.drawImage(arCaptureVideo, 0, 0, frameCanvas.width, frameCanvas.height);

      const segMask = await segmentFrame(frameCanvas);
      const userMesh = await detectFaceMesh(frameCanvas, frameCanvas.width, frameCanvas.height);
      const userFace = await detectFaceBox(frameCanvas, frameCanvas.width, frameCanvas.height);
      let maskCanvas = segMask;
      if (userMesh) {
        const ovalMask = ovalMaskFromMeshCanvas(userMesh, 8);
        maskCanvas = multiplyMaskCanvases(segMask, ovalMask);
      }

      captureState = { frameCanvas, maskCanvas, userMesh, userFace };
      await renderCurrentBlend();

      arCaptureShell.classList.remove('is-processing');
      arCaptureShell.classList.add('is-result');
      arProcessing.setAttribute('aria-hidden', 'true');
      arCaptureNote.textContent = `Scene blended: ${sceneName}.`;
    } catch {
      arCaptureShell.classList.remove('is-processing');
      arProcessing.setAttribute('aria-hidden', 'true');
      arCaptureNote.textContent = 'Blend failed. Please capture again and allow camera access.';
    } finally {
      blendInFlight = false;
    }
  });

  arSceneButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      arSceneButtons.forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      applyArSceneDepth(arSceneButtons);
      syncStageLayout();
      syncStagePreview();
      arCaptureNote.textContent = `Scene locked: ${getActiveSceneName(arSceneButtons)}.`;

      if (arCaptureShell.classList.contains('is-result') && captureState && !blendInFlight) {
        try {
          blendInFlight = true;
          arCaptureNote.textContent = `Reblending for ${getActiveSceneName(arSceneButtons)}...`;
          await renderCurrentBlend();
          arCaptureNote.textContent = `Scene blended: ${getActiveSceneName(arSceneButtons)}.`;
        } finally {
          blendInFlight = false;
        }
      }
    });
  });

  applyArSceneDepth(arSceneButtons);
  syncStageLayout();
  syncStagePreview();

  if (arScenesStrip) {
    const supportsHover = window.matchMedia('(hover: hover)').matches;
    if (supportsHover) {
      arScenesStrip.addEventListener('mousemove', (event) => {
        const rect = arScenesStrip.getBoundingClientRect();
        const relative = (event.clientX - rect.left) / rect.width;
        const normalized = (relative - 0.5) * 2;
        const maxShift = Math.min(58, Math.max(24, rect.width * 0.06));
        stripTargetX = normalized * maxShift;
      });
      arScenesStrip.addEventListener('mouseleave', () => {
        stripTargetX = 0;
      });
    }
    requestAnimationFrame(() => {
      arScenesStrip.classList.add('is-ready');
    });
  }

  window.addEventListener('resize', () => {
    if (!window.matchMedia('(hover: hover)').matches && arScenesStrip) {
      stripTargetX = 0;
      stripCurrentX = 0;
      arScenesStrip.style.transform = 'translate3d(0, 0, 0)';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopCamera();
  });

  window.addEventListener('beforeunload', () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });

  if (!arSegmenterReady) {
    arSegmenterReady = true;
    animateStrip();
  }
}

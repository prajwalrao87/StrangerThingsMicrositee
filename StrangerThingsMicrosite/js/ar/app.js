let arUiReady = false;
const AR_DEFAULT_PREVIEW = 'assets/cast/eleven.jpg';
const SWAP_API_URL = '/api/swap';
const SWAP_API_FALLBACK_URL = 'http://127.0.0.1:8000/swap';
const SWAP_TIMEOUT_MS = 180000;
const CAPTURE_MAX_WIDTH = 1024;

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

function sceneSrcToAssetPath(sceneSrc) {
  if (!sceneSrc) return null;
  const normalized = new URL(sceneSrc, window.location.href).pathname.replace(/^\/+/, '');
  return normalized.startsWith('assets/') ? normalized : null;
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.96) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Could not create image blob'));
      else resolve(blob);
    }, type, quality);
  });
}

async function renderHostedSwap({ outCanvas, sourceBlob, sceneAssetPath }) {
  const postWithTimeout = async (url, payloadFactory) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SWAP_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'POST',
        body: payloadFactory(),
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const makePayload = () => {
    const formData = new FormData();
    formData.append('source', sourceBlob, 'capture.jpg');
    formData.append('scene_path', sceneAssetPath);
    return formData;
  };

  let response;
  try {
    response = await postWithTimeout(SWAP_API_URL, makePayload);
  } catch {
    response = await postWithTimeout(SWAP_API_FALLBACK_URL, makePayload);
  }

  if (response.status === 404 && SWAP_API_URL !== SWAP_API_FALLBACK_URL) {
    response = await postWithTimeout(SWAP_API_FALLBACK_URL, makePayload);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Swap failed (${response.status})`);
  }

  const outBlob = await response.blob();
  const imageBitmap = await createImageBitmap(outBlob);
  outCanvas.width = imageBitmap.width;
  outCanvas.height = imageBitmap.height;
  const ctx = outCanvas.getContext('2d');
  ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();
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
  const STRIP_LERP = 0.18;

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
    const sceneAssetPath = sceneSrcToAssetPath(sceneSrc);
    if (!sceneAssetPath) throw new Error('Invalid scene path');

    await renderHostedSwap({
      outCanvas: arBlendCanvas,
      sourceBlob: captureState.frameBlob,
      sceneAssetPath
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
      const rawWidth = arCaptureVideo.videoWidth || 1280;
      const rawHeight = arCaptureVideo.videoHeight || 720;
      const scale = rawWidth > CAPTURE_MAX_WIDTH ? CAPTURE_MAX_WIDTH / rawWidth : 1;
      frameCanvas.width = Math.max(1, Math.round(rawWidth * scale));
      frameCanvas.height = Math.max(1, Math.round(rawHeight * scale));
      const fctx = frameCanvas.getContext('2d');
      fctx.drawImage(arCaptureVideo, 0, 0, frameCanvas.width, frameCanvas.height);

      const frameBlob = await canvasToBlob(frameCanvas, 'image/jpeg', 0.96);
      captureState = { frameBlob };
      await renderCurrentBlend();

      arCaptureShell.classList.remove('is-processing');
      arCaptureShell.classList.add('is-result');
      arProcessing.setAttribute('aria-hidden', 'true');
      arCaptureNote.textContent = `Scene blended: ${sceneName}.`;
    } catch (error) {
      arCaptureShell.classList.remove('is-processing');
      arProcessing.setAttribute('aria-hidden', 'true');
      const detail = error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out. Backend is busy or unreachable.'
        : (error instanceof Error ? error.message : '');
      arCaptureNote.textContent = `Swap failed. ${detail}`.trim();
      console.error('Swap failed:', error);
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

  if (!arUiReady) {
    arUiReady = true;
    animateStrip();
  }
}

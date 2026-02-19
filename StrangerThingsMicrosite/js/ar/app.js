import { detectFaceBox } from './face.js';

let arUiReady = false;
const AR_DEFAULT_PREVIEW = 'assets/cast/eleven.jpg';
const HF_SPACE_BASE_URL = 'https://musicutilist-face-integr.hf.space';
const HF_SWAP_API_PATH = '/run/predict';
const SWAP_TIMEOUT_MS = 240000;
const CAPTURE_MAX_WIDTH = 1280;
const CAPTURE_JPEG_QUALITY = 0.96;
const FACE_ENHANCE_DEFAULT = true;
const FACE_DETECT_MIN_AREA_RATIO = 0.055;
const FACE_DETECT_MIN_WIDTH_RATIO = 0.2;
const AR_LOADING_AUDIO_SRC = '/assets/audios/StrangerThings.mp3';
const AR_LOADING_AUDIO_SRC_FALLBACK = 'assets/audios/StrangerThings.mp3';

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

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.96) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Could not create image blob'));
      else resolve(blob);
    }, type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });
}

function normalizeOutputImageSrc(output) {
  if (typeof output !== 'string' || !output) return '';
  if (output.startsWith('data:image/')) return output;
  if (output.startsWith('http://') || output.startsWith('https://')) return output;
  return `data:image/png;base64,${output}`;
}

function extractImageFromPredictResponse(result) {
  const payload = result?.data?.[0];
  if (typeof payload === 'string') return normalizeOutputImageSrc(payload);
  if (payload && typeof payload === 'object') {
    return normalizeOutputImageSrc(payload.data || payload.url || payload.path || '');
  }
  return '';
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

async function callSwapEndpoint(sourceValue, targetValue, enhance) {
  const payload = JSON.stringify({
    data: [sourceValue, targetValue, !!enhance]
  });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SWAP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${HF_SPACE_BASE_URL}${HF_SWAP_API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (!response.ok) throw new Error(`Swap failed (${response.status})`);
  const result = await response.json();
  const outputSrc = extractImageFromPredictResponse(result);
  if (!outputSrc) throw new Error('Swap response did not include an output image.');
  return outputSrc;
}

export async function swapFaces(sourceBase64, targetBase64, enhance = true) {
  const bestOutput = await callSwapEndpoint(sourceBase64, targetBase64, enhance);
  const resultImage = document.getElementById('result');
  if (resultImage) {
    resultImage.src = bestOutput;
    resultImage.style.display = 'block';
  }
  return bestOutput;
}

if (typeof window !== 'undefined') {
  window.swapFaces = swapFaces;
}

async function renderHostedSwap({ outCanvas, sourceBlob, sceneSrc }) {
  const sourceBase64 = await blobToDataUrl(sourceBlob);
  const targetBlob = await fetch(sceneSrc).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load scene (${response.status})`);
    }
    return response.blob();
  });
  const targetBase64 = await blobToDataUrl(targetBlob);
  const outputSrc = await swapFaces(sourceBase64, targetBase64, FACE_ENHANCE_DEFAULT);
  return drawImageToCanvas(outputSrc, outCanvas);
}

async function drawImageToCanvas(outputSrc, outCanvas) {
  const outputImage = await loadImage(outputSrc);
  outCanvas.width = outputImage.naturalWidth || outputImage.width;
  outCanvas.height = outputImage.naturalHeight || outputImage.height;
  const ctx = outCanvas.getContext('2d');
  ctx.clearRect(0, 0, outCanvas.width, outCanvas.height);
  ctx.drawImage(outputImage, 0, 0, outCanvas.width, outCanvas.height);
  return outputSrc;
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
  const arDownloadBtn = document.getElementById('arDownloadBtn');
  const arShareBtn = document.getElementById('arShareBtn');
  const arCaptureNote = document.getElementById('arCaptureNote');
  const arSceneButtons = Array.from(document.querySelectorAll('.ar-scene'));
  const arPanel = document.querySelector('.panel-ar');
  const arStage = document.getElementById('arStage');
  const arLaunchImage = document.querySelector('#arLaunchBtn img');
  const arCaptureShell = document.querySelector('.ar-capture-shell');
  const arResultImage = document.getElementById('result');
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
  let audioPrimed = false;
  let loadingAudioRequested = false;
  const loadingAudio = document.createElement('audio');
  loadingAudio.preload = 'auto';
  loadingAudio.loop = true;
  loadingAudio.volume = 0.9;
  loadingAudio.playsInline = true;
  loadingAudio.setAttribute('playsinline', '');
  loadingAudio.setAttribute('webkit-playsinline', '');
  loadingAudio.src = AR_LOADING_AUDIO_SRC;
  loadingAudio.load();

  let triedAudioFallbackPath = false;
  loadingAudio.addEventListener('error', () => {
    if (triedAudioFallbackPath) return;
    triedAudioFallbackPath = true;
    loadingAudio.src = AR_LOADING_AUDIO_SRC_FALLBACK;
    loadingAudio.load();
  });
  const faceDetector = ('FaceDetector' in window)
    ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 })
    : null;

  const primeLoadingAudioFromGesture = () => {
    if (audioPrimed) return;
    try {
      loadingAudio.muted = false;
      loadingAudio.volume = 0.01;
      const primeAttempt = loadingAudio.play();
      if (primeAttempt && typeof primeAttempt.then === 'function') {
        primeAttempt.then(() => {
          if (!loadingAudioRequested) {
            loadingAudio.pause();
            loadingAudio.currentTime = 0;
          }
          loadingAudio.muted = false;
          loadingAudio.volume = 0.9;
          audioPrimed = true;
        }).catch(() => {
          // Fallback unlock flow for stricter mobile autoplay policies.
          try {
            loadingAudio.muted = true;
            const mutedAttempt = loadingAudio.play();
            if (mutedAttempt && typeof mutedAttempt.then === 'function') {
              mutedAttempt.then(() => {
                if (!loadingAudioRequested) {
                  loadingAudio.pause();
                  loadingAudio.currentTime = 0;
                }
                loadingAudio.muted = false;
                loadingAudio.volume = 0.9;
                audioPrimed = true;
              }).catch(() => {
                loadingAudio.muted = false;
                loadingAudio.volume = 0.9;
              });
            } else {
              loadingAudio.muted = false;
              loadingAudio.volume = 0.9;
            }
          } catch (_err) {
            loadingAudio.muted = false;
            loadingAudio.volume = 0.9;
          }
        });
      } else {
        loadingAudio.volume = 0.9;
      }
    } catch (_err) {
      loadingAudio.muted = false;
      loadingAudio.volume = 0.9;
    }
  };

  const startLoadingAudio = () => {
    try {
      loadingAudioRequested = true;
      loadingAudio.muted = false;
      loadingAudio.volume = 0.9;
      loadingAudio.currentTime = 0;
      const playAttempt = loadingAudio.play();
      if (playAttempt && typeof playAttempt.catch === 'function') {
        playAttempt.catch(() => {
          // Some mobile browsers need an explicit load + replay.
          try {
            loadingAudio.load();
            const retry = loadingAudio.play();
            if (retry && typeof retry.catch === 'function') {
              retry.catch(() => {});
            }
          } catch (_err) {
            // No-op.
          }
        });
      }
    } catch (_err) {
      // No-op: UI should continue even if audio cannot start.
    }
  };

  const stopLoadingAudio = () => {
    try {
      loadingAudioRequested = false;
      loadingAudio.pause();
      loadingAudio.currentTime = 0;
    } catch (_err) {
      // No-op: keep flow resilient.
    }
  };

  const releaseCameraStream = () => {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    arCaptureVideo.srcObject = null;
  };

  const getResultSrc = () => arResultImage?.getAttribute('src') || '';

  const updateResultActionState = () => {
    const hasResult = !!getResultSrc();
    if (arDownloadBtn) arDownloadBtn.disabled = !hasResult;
    if (arShareBtn) arShareBtn.disabled = !hasResult;
  };

  const toResultBlob = async () => {
    const src = getResultSrc();
    if (src) {
      try {
        const response = await fetch(src);
        if (response.ok) return response.blob();
      } catch (_err) {
        // Fallback to blend canvas below.
      }
    }
    return canvasToBlob(arBlendCanvas, 'image/png', 0.96);
  };

  const validateFaceSize = async (frameCanvas) => {
    try {
      let box = null;

      if (faceDetector) {
        const faces = await faceDetector.detect(frameCanvas);
        if (faces && faces.length > 0) {
          box = faces[0]?.boundingBox || null;
        }
      } else {
        const mpFace = await detectFaceBox(frameCanvas, frameCanvas.width, frameCanvas.height);
        if (mpFace) {
          box = { width: mpFace.w, height: mpFace.h };
        }
      }

      if (!box) {
        return { ok: false, reason: 'Face is not detected. Keep your face in center and retry.' };
      }

      const frameArea = Math.max(1, frameCanvas.width * frameCanvas.height);
      const faceArea = Math.max(1, box.width * box.height);
      const areaRatio = faceArea / frameArea;
      const widthRatio = box.width / Math.max(1, frameCanvas.width);

      if (areaRatio < FACE_DETECT_MIN_AREA_RATIO || widthRatio < FACE_DETECT_MIN_WIDTH_RATIO) {
        return { ok: false, reason: 'Face is too small. Move closer to camera and recapture.' };
      }

      return { ok: true, reason: '' };
    } catch (_err) {
      return { ok: false, reason: 'Face is not detected. Please retry with better lighting.' };
    }
  };

  const animateStrip = () => {
    if (arScenesStrip) {
      arScenesStrip.style.transform = 'translate3d(0, 0, 0)';
    }
    requestAnimationFrame(animateStrip);
  };

  const resetCaptureState = () => {
    stopLoadingAudio();
    arCaptureShell.classList.remove('is-processing', 'is-result');
    arProcessing.setAttribute('aria-hidden', 'true');
    if (arResultImage) {
      arResultImage.removeAttribute('src');
      arResultImage.style.display = 'none';
    }
    captureState = null;
    updateResultActionState();
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
    if (arScenesStrip) {
      arScenesStrip.style.transform = 'translate3d(0, 0, 0)';
    }
    const isSmallScreen = window.matchMedia('(max-width: 640px)').matches;
    arPanel.scrollIntoView({ behavior: 'smooth', block: isSmallScreen ? 'start' : 'center' });

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
    stopLoadingAudio();
    if (document.activeElement && arCaptureWrap.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    releaseCameraStream();
    arCaptureWrap.classList.remove('open');
    arCaptureWrap.setAttribute('aria-hidden', 'true');
    arPanel.classList.remove('is-camera-open');
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
    await renderHostedSwap({
      outCanvas: arBlendCanvas,
      sourceBlob: captureState.frameBlob,
      sceneSrc
    });
    syncStageLayout();
    syncStagePreview();
  };

  arLaunchBtn.addEventListener('click', () => {
    primeLoadingAudioFromGesture();
    startCamera();
  });
  arLaunchBtn.addEventListener('pointerdown', primeLoadingAudioFromGesture, { passive: true });
  arLaunchBtn.addEventListener('touchstart', primeLoadingAudioFromGesture, { passive: true });

  arCaptureCloseBtn.addEventListener('click', () => {
    stopCamera();
  });

  if (arDownloadBtn) {
    arDownloadBtn.addEventListener('click', async () => {
      const src = getResultSrc();
      if (!src) {
        arCaptureNote.textContent = 'Capture and blend first to download.';
        return;
      }

      try {
        const blob = await toResultBlob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `stranger-things-avatar-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Download failed.';
        arCaptureNote.textContent = `Download failed. ${detail}`;
      }
    });
  }

  if (arShareBtn) {
    arShareBtn.addEventListener('click', async () => {
      if (!getResultSrc()) {
        arCaptureNote.textContent = 'Capture and blend first to share.';
        return;
      }

      if (!navigator.share) {
        arCaptureNote.textContent = 'Share is not supported on this browser. Use Download.';
        return;
      }

      try {
        const blob = await toResultBlob();
        const extension = (blob.type || '').includes('jpeg') ? 'jpg' : 'png';
        const file = new File([blob], `stranger-things-avatar.${extension}`, {
          type: blob.type || 'image/png'
        });

        const payloadWithFile = {
          title: 'Stranger Things AR Avatar',
          text: 'My Stranger Things AR avatar',
          files: [file]
        };

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share(payloadWithFile);
        } else {
          await navigator.share({
            title: 'Stranger Things AR Avatar',
            text: 'My Stranger Things AR avatar is ready. Download is available in-app.'
          });
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const detail = error instanceof Error ? error.message : 'Share failed.';
        arCaptureNote.textContent = `Share failed. ${detail}`;
      }
    });
  }

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
    startLoadingAudio();

    try {
      const frameCanvas = document.createElement('canvas');
      const rawWidth = arCaptureVideo.videoWidth || 1280;
      const rawHeight = arCaptureVideo.videoHeight || 720;
      const viewWidth = Math.max(1, arCaptureVideo.clientWidth || rawWidth);
      const viewHeight = Math.max(1, arCaptureVideo.clientHeight || rawHeight);
      const viewAspect = viewWidth / viewHeight;
      const rawAspect = rawWidth / rawHeight;

      let srcX = 0;
      let srcY = 0;
      let srcW = rawWidth;
      let srcH = rawHeight;

      // Match capture crop with CSS object-fit: cover preview.
      if (rawAspect > viewAspect) {
        srcW = Math.max(1, Math.round(rawHeight * viewAspect));
        srcX = Math.round((rawWidth - srcW) / 2);
      } else if (rawAspect < viewAspect) {
        srcH = Math.max(1, Math.round(rawWidth / viewAspect));
        srcY = Math.round((rawHeight - srcH) / 2);
      }

      const scale = srcW > CAPTURE_MAX_WIDTH ? CAPTURE_MAX_WIDTH / srcW : 1;
      frameCanvas.width = Math.max(1, Math.round(srcW * scale));
      frameCanvas.height = Math.max(1, Math.round(srcH * scale));
      const fctx = frameCanvas.getContext('2d');
      fctx.drawImage(
        arCaptureVideo,
        srcX,
        srcY,
        srcW,
        srcH,
        0,
        0,
        frameCanvas.width,
        frameCanvas.height
      );

      const faceCheck = await validateFaceSize(frameCanvas);
      if (!faceCheck.ok) {
        stopLoadingAudio();
        arCaptureShell.classList.remove('is-processing');
        arProcessing.setAttribute('aria-hidden', 'true');
        arCaptureNote.textContent = faceCheck.reason;
        return;
      }

      const frameBlob = await canvasToBlob(frameCanvas, 'image/jpeg', CAPTURE_JPEG_QUALITY);
      captureState = { frameBlob };
      // Turn camera off immediately after capture.
      releaseCameraStream();
      await renderCurrentBlend();

      arCaptureShell.classList.remove('is-processing');
      arCaptureShell.classList.add('is-result');
      arProcessing.setAttribute('aria-hidden', 'true');
      arCaptureNote.textContent = `Scene blended: ${sceneName}.`;
      stopLoadingAudio();
      updateResultActionState();
    } catch (error) {
      stopLoadingAudio();
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
  arCaptureBtn.addEventListener('pointerdown', primeLoadingAudioFromGesture, { passive: true });
  arCaptureBtn.addEventListener('touchstart', primeLoadingAudioFromGesture, { passive: true });

  arSceneButtons.forEach((button) => {
    button.addEventListener('pointerdown', primeLoadingAudioFromGesture, { passive: true });
    button.addEventListener('touchstart', primeLoadingAudioFromGesture, { passive: true });
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
          const activeSceneName = getActiveSceneName(arSceneButtons);
          if (arProcessingTitle) {
            arProcessingTitle.textContent = activeSceneName === 'Upside Down' ? 'Opening Upside Down gate...' : 'Stabilizing portal...';
          }
          if (arProcessingSub) {
            arProcessingSub.textContent = `Binding to ${activeSceneName} scene`;
          }
          arCaptureShell.classList.add('is-processing');
          arCaptureShell.classList.remove('is-result');
          arProcessing.setAttribute('aria-hidden', 'false');
          arCaptureNote.textContent = `Reblending for ${activeSceneName}...`;
          startLoadingAudio();
          await renderCurrentBlend();
          arCaptureShell.classList.remove('is-processing');
          arCaptureShell.classList.add('is-result');
          arProcessing.setAttribute('aria-hidden', 'true');
          stopLoadingAudio();
          arCaptureNote.textContent = `Scene blended: ${getActiveSceneName(arSceneButtons)}.`;
          updateResultActionState();
        } catch (error) {
          stopLoadingAudio();
          arCaptureShell.classList.remove('is-processing');
          arProcessing.setAttribute('aria-hidden', 'true');
          arCaptureNote.textContent = `Reblend failed. ${error instanceof Error ? error.message : ''}`.trim();
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
    requestAnimationFrame(() => {
      arScenesStrip.classList.add('is-ready');
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopCamera();
  });

  window.addEventListener('beforeunload', () => {
    stopLoadingAudio();
    releaseCameraStream();
  });

  if (!arUiReady) {
    arUiReady = true;
    animateStrip();
  }

  updateResultActionState();
}

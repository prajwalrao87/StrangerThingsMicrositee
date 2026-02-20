# Stranger Things Microsite - Current Documentation

## Overview
This is a Vite-based single-page microsite built with vanilla HTML, CSS, and JavaScript.

Main features:
- Cinematic landing and section navigation
- AR face-swap experience (capture + scene blending)
- Trailer modal with YouTube embed
- Upside Down interaction panel
- Result download/share actions

## Tech Stack
- Frontend: Vanilla JS, HTML, CSS
- Build tool: Vite
- AR backend: Hugging Face Space (Gradio)

## Run Commands
From `StrangerThingsMicrosite`:

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Key Files
- `index.html`: main structure, AR section, trailer modal
- `style.css`: all theme, layout, and responsive styling
- `main.js`: global page behavior (nav, trailer modal, parallax, refresh-to-landing)
- `js/ar/app.js`: AR capture + face validation + backend call + result actions
- `js/ar/face.js`: lightweight MediaPipe face detection fallback

## AR Experience Flow
1. User opens camera from AR panel.
2. Live camera is shown in frame (`object-fit: cover`).
3. On capture:
   - Frame is cropped to match visible preview.
   - Face validation runs before API request.
4. If face is valid:
   - Camera stream is stopped immediately.
   - Source face + selected scene are sent to backend.
5. Result is rendered in AR frame.
6. User can download/share output.

If no face is detected, API call is blocked and an error message is shown.

## Face Detection (Fast + Cross-Browser)
`js/ar/app.js` uses:
- Native `FaceDetector` when available (fast mode)
- Fallback to `detectFaceBox()` from `js/ar/face.js` (MediaPipe short model)

Validation thresholds:
- `FACE_DETECT_MIN_AREA_RATIO = 0.055`
- `FACE_DETECT_MIN_WIDTH_RATIO = 0.2`

## Backend Integration (Current)
Configured in `js/ar/app.js`:
- Space ID: `akashh89/faceIntegrator`
- Preferred API name: `/swap_face`
- Fallback `fn_index`: `2`
- Gradio client loaded from CDN:
  - `https://cdn.jsdelivr.net/npm/@gradio/client/+esm`

Vite note:
- Dynamic CDN import uses `/* @vite-ignore */` to avoid Vite import-analysis warnings.

## Trailer Modal Behavior
In `main.js`:
- Opening trailer restores iframe `src` if needed
- Closing trailer clears iframe `src` so YouTube audio stops

## Refresh Behavior
In `main.js`:
- On reload navigation, page is forced to landing (`#home`) and smoothly scrolls to top
- Regular section navigation remains unchanged

## Result Actions
In AR panel:
- `Download`: saves blended output image
- `Share`: uses Web Share API where supported (fallback message when unavailable)

## Known Notes
- MediaPipe/WebGL console logs are informational and expected.
- Hugging Face Space endpoint/schema changes may require updating:
  - API name `/swap_face`
  - fallback `fn_index`


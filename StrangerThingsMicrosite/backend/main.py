import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image


BASE_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = Path(__file__).resolve().parent
ASSETS_DIR = BASE_DIR / "assets"
OUTPUTS_DIR = BACKEND_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
TARGET_CACHE_DIR = BACKEND_DIR / "cache_targets"
TARGET_CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_FACEFUSION_CWD = Path(r"C:\AR project\StrangerThings\FaceFusion\facefusion")
FACEFUSION_CWD = Path(os.getenv("FACEFUSION_CWD", str(DEFAULT_FACEFUSION_CWD)))
FACEFUSION_SCRIPT = Path(os.getenv("FACEFUSION_SCRIPT", str(FACEFUSION_CWD / "facefusion.py")))
DEFAULT_FACEFUSION_PYTHON = FACEFUSION_CWD.parent / ".venv" / "Scripts" / "python.exe"
FACEFUSION_PYTHON = Path(
    os.getenv(
        "FACEFUSION_PYTHON",
        str(DEFAULT_FACEFUSION_PYTHON if DEFAULT_FACEFUSION_PYTHON.exists() else Path(sys.executable)),
    )
)
SOURCE_MAX_DIM = int(os.getenv("SOURCE_MAX_DIM", "1024"))
TARGET_MAX_DIM = int(os.getenv("TARGET_MAX_DIM", "1280"))
EXECUTION_THREAD_COUNT = os.getenv("EXECUTION_THREAD_COUNT", "4")

app = FastAPI(title="Stranger Things Face Swap Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def resolve_scene_path(scene_path: str) -> Path:
    candidate = (BASE_DIR / scene_path).resolve()
    if not str(candidate).startswith(str(ASSETS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="scene_path must be inside assets/")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Scene not found: {scene_path}")
    return candidate


def resize_to_max_dim(input_path: Path, output_path: Path, max_dim: int) -> Path:
    if max_dim <= 0:
        return input_path

    with Image.open(input_path) as image:
        width, height = image.size
        largest = max(width, height)
        if largest <= max_dim:
            if input_path != output_path:
                image.save(output_path)
                return output_path
            return input_path
        scale = max_dim / float(largest)
        resized = image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
        resized.save(output_path)
    return output_path


def optimized_target_path(target_path: Path) -> Path:
    if TARGET_MAX_DIM <= 0:
        return target_path
    cached = TARGET_CACHE_DIR / f"{target_path.stem}_max{TARGET_MAX_DIM}{target_path.suffix.lower()}"
    if cached.exists() and cached.stat().st_mtime >= target_path.stat().st_mtime:
        return cached
    return resize_to_max_dim(target_path, cached, TARGET_MAX_DIM)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "facefusion_script": str(FACEFUSION_SCRIPT),
        "facefusion_script_exists": FACEFUSION_SCRIPT.exists(),
        "facefusion_python": str(FACEFUSION_PYTHON),
        "facefusion_python_exists": FACEFUSION_PYTHON.exists(),
        "assets_dir": str(ASSETS_DIR),
        "source_max_dim": SOURCE_MAX_DIM,
        "target_max_dim": TARGET_MAX_DIM,
        "execution_thread_count": EXECUTION_THREAD_COUNT,
    }


@app.post("/swap")
async def swap(source: UploadFile = File(...), scene_path: str = Form(...)):
    if not FACEFUSION_SCRIPT.exists():
        raise HTTPException(status_code=500, detail=f"facefusion.py not found at {FACEFUSION_SCRIPT}")
    if not FACEFUSION_PYTHON.exists():
        raise HTTPException(status_code=500, detail=f"Python not found at {FACEFUSION_PYTHON}")

    target_path = resolve_scene_path(scene_path)
    optimized_target = optimized_target_path(target_path)
    request_id = uuid.uuid4().hex[:10]
    source_raw_path = OUTPUTS_DIR / f"source_raw_{request_id}.jpg"
    source_path = OUTPUTS_DIR / f"source_{request_id}.jpg"
    # FaceFusion requires output extension to match target extension.
    output_path = OUTPUTS_DIR / f"swap_{request_id}{optimized_target.suffix.lower()}"

    source_bytes = await source.read()
    if not source_bytes:
        raise HTTPException(status_code=400, detail="Uploaded source image is empty")
    source_raw_path.write_bytes(source_bytes)
    source_path = resize_to_max_dim(source_raw_path, source_path, SOURCE_MAX_DIM)

    started = time.perf_counter()
    cmd = [
        str(FACEFUSION_PYTHON),
        str(FACEFUSION_SCRIPT),
        "headless-run",
        "--source-paths",
        str(source_path),
        "--target-path",
        str(optimized_target),
        "--output-path",
        str(output_path),
        "--processors",
        "face_swapper",
        "--face-swapper-model",
        "inswapper_128",
        "--face-swapper-pixel-boost",
        "256x256",
        "--face-selector-mode",
        "one",
        "--face-selector-order",
        "large-small",
        "--face-mask-types",
        "box",
        "occlusion",
        "--face-mask-blur",
        "0.35",
        "--face-detector-model",
        "scrfd",
        "--face-detector-score",
        "0.5",
        "--execution-providers",
        "cpu",
        "--execution-thread-count",
        EXECUTION_THREAD_COUNT,
        "--output-image-quality",
        "90",
        "--log-level",
        "info",
    ]

    result = subprocess.run(
        cmd,
        cwd=str(FACEFUSION_CWD),
        capture_output=True,
        text=True,
        timeout=1800,
        shell=False,
    )

    if result.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail=(
                "FaceFusion failed.\n"
                f"stdout:\n{result.stdout[-3000:]}\n"
                f"stderr:\n{result.stderr[-3000:]}"
            ),
        )

    if not output_path.exists():
        raise HTTPException(
            status_code=502,
            detail=(
                "FaceFusion finished but no output file was found.\n"
                f"stdout:\n{result.stdout[-3000:]}\n"
                f"stderr:\n{result.stderr[-3000:]}"
            ),
        )

    elapsed = time.perf_counter() - started
    media_type = "image/png" if output_path.suffix.lower() == ".png" else "image/jpeg"
    response = FileResponse(path=output_path, media_type=media_type, filename=output_path.name)
    response.headers["X-Swap-Elapsed-Sec"] = f"{elapsed:.2f}"
    return response

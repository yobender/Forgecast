"""Local-only Forgecast worker for Microsoft TRELLIS.2."""

from __future__ import annotations

import argparse
import io
import os
import sys
import threading
import traceback
import uuid
from importlib.util import find_spec
from pathlib import Path
from typing import Any

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

TRELLIS_SOURCE = os.environ.get("FORGECAST_TRELLIS_SOURCE")
if TRELLIS_SOURCE and TRELLIS_SOURCE not in sys.path:
    sys.path.insert(0, TRELLIS_SOURCE)

import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image

OUTPUT_ROOT = Path(os.environ.get("FORGECAST_TRELLIS_OUTPUTS", "/tmp/forgecast-trellis2")).resolve()
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Forgecast TRELLIS.2 Worker", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
generation_lock = threading.Lock()
pipeline = None


def set_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(updates)


def load_pipeline():
    global pipeline
    if pipeline is None:
        print("[Forgecast TRELLIS.2] Loading 4B model weights…", flush=True)
        from trellis2.pipelines import Trellis2ImageTo3DPipeline

        pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        pipeline.cuda()
    return pipeline


def run_generation(
    job_id: str,
    image_data: bytes,
    seed: int,
    resolution: int,
    inference_steps: int,
    target_triangles: int,
    texture_size: int,
) -> None:
    try:
        with generation_lock:
            set_job(job_id, status="running", progress=4, stage="concept", step="Preparing front reference…")
            image = Image.open(io.BytesIO(image_data)).convert("RGBA")
            set_job(job_id, progress=8, stage="concept", step="Loading TRELLIS.2 4B…")
            model = load_pipeline()
            set_job(job_id, progress=15, stage="shape", step=f"Generating {resolution}³ PBR asset…")
            pipeline_type = "512" if resolution <= 512 else "1024_cascade"
            outputs = model.run(
                image,
                seed=seed,
                pipeline_type=pipeline_type,
                sparse_structure_sampler_params={"steps": inference_steps},
                shape_slat_sampler_params={"steps": inference_steps},
                tex_slat_sampler_params={"steps": inference_steps},
            )
            mesh = outputs[0]
            mesh.simplify(16777216)
            set_job(job_id, progress=82, stage="texture", step="Baking PBR materials…")

            import o_voxel

            glb = o_voxel.postprocess.to_glb(
                vertices=mesh.vertices,
                faces=mesh.faces,
                attr_volume=mesh.attrs,
                coords=mesh.coords,
                attr_layout=mesh.layout,
                voxel_size=mesh.voxel_size,
                aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                decimation_target=max(5000, target_triangles),
                texture_size=max(1024, texture_size),
                remesh=True,
                remesh_band=1,
                remesh_project=0,
                verbose=True,
            )
            set_job(job_id, progress=96, stage="finalize", step="Exporting PBR GLB…")
            output_path = OUTPUT_ROOT / f"{job_id}.glb"
            glb.export(str(output_path), extension_webp=True)
            torch.cuda.empty_cache()
            set_job(
                job_id,
                status="done",
                progress=100,
                stage="finalize",
                step="TRELLIS.2 PBR asset ready",
                output_url=f"/outputs/{output_path.name}",
            )
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, status="error", error=str(exc), step="Generation failed")


@app.get("/health")
def health() -> dict[str, Any]:
    if find_spec("trellis2") is None:
        raise HTTPException(
            status_code=503,
            detail="TRELLIS.2 source package is not on the Python import path.",
        )
    return {
        "status": "healthy",
        "engine": "trellis-2",
        "source_available": True,
        "model_loaded": pipeline is not None,
        "message": "TRELLIS.2 runs in WSL2; the 4B checkpoint loads on the first cast.",
    }


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    seed: int = Form(42),
    resolution: int = Form(512),
    inference_steps: int = Form(20),
    target_triangles: int = Form(40000),
    texture_size: int = Form(2048),
) -> dict[str, str]:
    if resolution not in {512, 1024}:
        raise HTTPException(400, "resolution must be 512 or 1024")
    if not 1 <= inference_steps <= 50:
        raise HTTPException(400, "inference_steps must be between 1 and 50")
    image_data = await image.read()
    if not image_data:
        raise HTTPException(400, "image is empty")
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "pending", "progress": 1, "stage": "concept", "step": "Queued"}
    threading.Thread(
        target=run_generation,
        args=(job_id, image_data, seed, resolution, inference_steps, target_triangles, texture_size),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@app.get("/status/{job_id}")
def status(job_id: str) -> dict[str, Any]:
    if job_id not in jobs:
        raise HTTPException(404, "unknown job")
    with jobs_lock:
        return dict(jobs[job_id])


@app.get("/outputs/{filename}")
def output(filename: str):
    safe_name = Path(filename).name
    path = OUTPUT_ROOT / safe_name
    if safe_name != filename or not path.is_file():
        raise HTTPException(404, "output not found")
    return FileResponse(path, media_type="model/gltf-binary", filename=safe_name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8766, type=int)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

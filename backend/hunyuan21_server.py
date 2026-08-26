"""Local-only Forgecast worker for official Hunyuan3D 2.1 Shape + Paint."""

from __future__ import annotations

import argparse
import gc
import io
import os
import sys
import threading
import traceback
import types
import uuid
from contextlib import redirect_stdout
from importlib.util import find_spec
from pathlib import Path
from typing import Any

SOURCE_ROOT = Path(os.environ.get("FORGECAST_HUNYUAN21_SOURCE", "")).resolve()
if not (SOURCE_ROOT / "hy3dshape").is_dir():
    raise RuntimeError("FORGECAST_HUNYUAN21_SOURCE must point to the Hunyuan3D-2.1 source checkout.")
for source_path in (
    SOURCE_ROOT,
    SOURCE_ROOT / "hy3dshape",
    SOURCE_ROOT / "hy3dpaint",
    SOURCE_ROOT / "hy3dpaint" / "custom_rasterizer",
):
    if str(source_path) not in sys.path:
        sys.path.insert(0, str(source_path))

import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image

OUTPUT_ROOT = Path(os.environ.get("FORGECAST_HUNYUAN21_OUTPUTS", SOURCE_ROOT / ".forgecast-outputs")).resolve()
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Forgecast Hunyuan3D 2.1 Worker", version="1.0")
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
background_remover = None
REAL_ESRGAN_PATH = SOURCE_ROOT / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth"

PAINT_PROFILES: dict[str, dict[str, int | str]] = {
    "fast": {"label": "fast", "views": 3, "resolution": 320, "render_size": 512, "texture_size": 1024},
    "balanced": {"label": "balanced", "views": 4, "resolution": 384, "render_size": 768, "texture_size": 1024},
    "full": {"label": "full-quality", "views": 6, "resolution": 512, "render_size": 1024, "texture_size": 2048},
}


def set_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(updates)


def load_pipeline():
    global pipeline
    if pipeline is None:
        set_message = "Loading Hunyuan3D 2.1 model weights…"
        print(f"[Forgecast Hunyuan3D 2.1] {set_message}", flush=True)
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2.1",
            subfolder="hunyuan3d-dit-v2-1",
            device="cuda",
            dtype=torch.float16,
        )
    return pipeline


def clear_cuda_cache() -> None:
    gc.collect()
    torch.cuda.empty_cache()
    if hasattr(torch.cuda, "ipc_collect"):
        torch.cuda.ipc_collect()


def unload_shape_pipeline() -> None:
    global pipeline
    pipeline = None
    clear_cuda_cache()


def paint_dependencies_available() -> bool:
    required_modules = (
        "custom_rasterizer",
        "custom_rasterizer_kernel",
        "DifferentiableRenderer.mesh_inpaint_processor",
        "realesrgan",
    )
    try:
        return REAL_ESRGAN_PATH.is_file() and all(find_spec(module) is not None for module in required_modules)
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def load_paint_pipeline(paint_profile: str):
    from torchvision_fix import apply_fix

    apply_fix()
    # Tencent's exporter imports Blender eagerly even when GLB conversion is
    # disabled. Forgecast uses their Blender-free PBR converter below instead.
    sys.modules.setdefault("bpy", types.ModuleType("bpy"))
    from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline

    profile = PAINT_PROFILES[paint_profile]
    config = Hunyuan3DPaintConfig(
        max_num_view=int(profile["views"]),
        resolution=int(profile["resolution"]),
    )
    config.realesrgan_ckpt_path = str(REAL_ESRGAN_PATH)
    config.multiview_cfg_path = str(SOURCE_ROOT / "hy3dpaint" / "cfgs" / "hunyuan-paint-pbr.yaml")
    config.custom_pipeline = str(SOURCE_ROOT / "hy3dpaint" / "hunyuanpaintpbr")
    config.render_size = int(profile["render_size"])
    config.texture_size = int(profile["texture_size"])

    paint_pipeline = Hunyuan3DPaintPipeline(config)
    # The upstream default expands every view with RealESRGAN, bakes at 2K into
    # a 4K atlas, then downsamples. That can run for hours on Windows. Forgecast
    # instead bakes each explicit profile at its native output size, preserving
    # Hunyuan's geometry-guided material placement without the redundant pass.
    paint_pipeline.models["super_model"] = lambda image: image
    save_mesh = paint_pipeline.render.save_mesh
    paint_pipeline.render.save_mesh = lambda mesh_path, downsample=False: save_mesh(mesh_path, downsample=False)
    return paint_pipeline


def prepare_image(data: bytes) -> Image.Image:
    global background_remover
    image = Image.open(io.BytesIO(data))
    had_alpha = image.mode in {"RGBA", "LA"} and image.getchannel("A").getextrema()[0] < 255
    image = image.convert("RGBA")
    if had_alpha:
        return image
    try:
        from hy3dshape.rembg import BackgroundRemover

        if background_remover is None:
            background_remover = BackgroundRemover()
        return background_remover(image)
    except Exception as exc:
        print(f"[Forgecast Hunyuan3D 2.1] Background removal skipped: {exc}", flush=True)
        return image


def run_generation(
    job_id: str,
    image_data: bytes,
    seed: int,
    resolution: int,
    inference_steps: int,
    target_triangles: int,
    texture_size: int,
    paint_profile: str,
) -> None:
    try:
        with generation_lock:
            set_job(job_id, status="running", progress=4, stage="concept", step="Preparing front reference…")
            image = prepare_image(image_data)
            set_job(job_id, progress=8, stage="concept", step="Loading Hunyuan3D 2.1…")
            model = load_pipeline()

            generator = torch.Generator(device="cuda").manual_seed(seed)

            shape_end = 70 if texture_size > 0 else 88

            def progress_callback(step: int, _timestep: Any, _outputs: Any) -> None:
                percent = 15 + round((shape_end - 15) * (step + 1) / max(1, inference_steps))
                set_job(job_id, progress=percent, stage="shape", step=f"Generating shape · step {step + 1}/{inference_steps}")

            set_job(job_id, progress=12, stage="shape", step="Generating high-fidelity shape…")
            mesh = model(
                image=image,
                num_inference_steps=inference_steps,
                guidance_scale=5.0,
                octree_resolution=resolution,
                num_chunks=8000,
                generator=generator,
                callback=progress_callback,
                callback_steps=1,
            )[0]

            if target_triangles > 0 and len(mesh.faces) > target_triangles:
                optimize_progress = 74 if texture_size > 0 else 90
                set_job(job_id, progress=optimize_progress, stage="shape", step=f"Optimizing to about {target_triangles:,} triangles…")
                try:
                    mesh = mesh.simplify_quadric_decimation(face_count=target_triangles)
                except Exception as exc:
                    print(f"[Forgecast Hunyuan3D 2.1] Mesh optimization skipped: {exc}", flush=True)

            if texture_size > 0:
                work_path = OUTPUT_ROOT / f"{job_id}-work"
                work_path.mkdir(parents=True, exist_ok=True)
                shape_path = work_path / "shape.glb"
                mesh.export(shape_path)
                del mesh
                del model
                set_job(job_id, progress=78, stage="texture", step="Unloading Shape model to free VRAM…")
                unload_shape_pipeline()

                paint_model = None
                try:
                    set_job(job_id, progress=81, stage="texture", step="Loading Hunyuan3D Paint 2.1…")
                    paint_model = load_paint_pipeline(paint_profile)
                    profile = PAINT_PROFILES[paint_profile]
                    texture_step = (
                        f"Generating {profile['label']} PBR materials · {profile['views']} guided views · "
                        f"{int(profile['texture_size']) // 1024}K atlas…"
                    )
                    set_job(job_id, progress=88, stage="texture", step=texture_step)
                    textured_obj_path = work_path / "textured.obj"
                    paint_model(
                        mesh_path=str(shape_path),
                        image_path=image,
                        output_mesh_path=str(textured_obj_path),
                        use_remesh=True,
                        save_glb=False,
                    )
                    from convert_utils import create_glb_with_pbr_materials

                    output_path = OUTPUT_ROOT / f"{job_id}.glb"
                    textures = {
                        "albedo": str(textured_obj_path.with_suffix(".jpg")),
                        "metallic": str(textured_obj_path.with_name(f"{textured_obj_path.stem}_metallic.jpg")),
                        "roughness": str(textured_obj_path.with_name(f"{textured_obj_path.stem}_roughness.jpg")),
                    }
                    previous_cwd = Path.cwd()
                    try:
                        os.chdir(work_path)
                        # Tencent's converter prints a Chinese success message;
                        # the default Windows CP-1252 log stream cannot encode it.
                        with redirect_stdout(io.StringIO()):
                            create_glb_with_pbr_materials(str(textured_obj_path), textures, str(output_path))
                    finally:
                        os.chdir(previous_cwd)
                    if not output_path.is_file():
                        raise RuntimeError("Hunyuan3D Paint finished without producing a GLB file.")
                finally:
                    paint_model = None
                    clear_cuda_cache()
                ready_step = "Hunyuan3D 2.1 PBR asset ready"
            else:
                set_job(job_id, progress=94, stage="finalize", step="Exporting shape-only GLB…")
                output_path = OUTPUT_ROOT / f"{job_id}.glb"
                mesh.export(output_path)
                torch.cuda.empty_cache()
                ready_step = "Hunyuan3D 2.1 shape asset ready"

            set_job(job_id, progress=97, stage="finalize", step="Finalizing GLB…")
            set_job(
                job_id,
                status="done",
                progress=100,
                stage="finalize",
                step=ready_step,
                output_url=f"/outputs/{output_path.name}",
            )
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, status="error", error=str(exc), step="Generation failed")


@app.get("/health")
def health() -> dict[str, Any]:
    paint_available = paint_dependencies_available()
    return {
        "status": "healthy",
        "engine": "hunyuan-2.1",
        "model_loaded": pipeline is not None,
        "paint_available": paint_available,
        "message": (
            "Official Hunyuan3D 2.1 Shape + PBR Paint; checkpoints load on first use."
            if paint_available
            else "Shape is ready; run setup-hunyuan21.ps1 again to install PBR Paint."
        ),
    }


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    seed: int = Form(1234),
    resolution: int = Form(384),
    inference_steps: int = Form(35),
    target_triangles: int = Form(40000),
    texture_size: int = Form(0),
    paint_profile: str = Form("auto"),
) -> dict[str, str]:
    if resolution not in {256, 384, 512}:
        raise HTTPException(400, "resolution must be 256, 384, or 512")
    if not 1 <= inference_steps <= 100:
        raise HTTPException(400, "inference_steps must be between 1 and 100")
    if texture_size not in {0, 1024, 2048}:
        raise HTTPException(400, "texture_size must be 0, 1024, or 2048")
    if paint_profile == "auto":
        paint_profile = "fast" if texture_size == 1024 else "full"
    if paint_profile not in PAINT_PROFILES:
        raise HTTPException(400, "paint_profile must be fast, balanced, or full")
    if texture_size > 0:
        texture_size = int(PAINT_PROFILES[paint_profile]["texture_size"])
    if texture_size > 0 and not paint_dependencies_available():
        raise HTTPException(409, "Hunyuan3D Paint is not installed. Run scripts/setup-hunyuan21.ps1 again.")
    image_data = await image.read()
    if not image_data:
        raise HTTPException(400, "image is empty")
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"status": "pending", "progress": 1, "stage": "concept", "step": "Queued"}
    threading.Thread(
        target=run_generation,
        args=(job_id, image_data, seed, resolution, inference_steps, target_triangles, texture_size, paint_profile),
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
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8081, type=int)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

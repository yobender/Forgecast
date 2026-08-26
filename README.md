# Forgecast Studio

Forgecast is a local-first image-to-3D studio with selectable Hunyuan3D and TRELLIS backends. It supports single- and multi-reference inputs, Polygon-game art direction, high-detail meshes, an interactive color/wireframe preview, PBR-ready assets, and GLB/STL/recipe exports.

## Generation engines

| Engine | Best use | Platform | GPU memory | Output |
| --- | --- | --- | --- | --- |
| Hunyuan3D 2 Mini | Fast iteration and exact-turntable multi-view fusion | Windows | 12 GB+ recommended | Color GLB |
| Hunyuan3D 2.1 | Single-image shape generation and guided PBR painting | Windows | About 10 GB shape / 21 GB paint | Shape or PBR GLB |
| TRELLIS.2 4B | Highest-fidelity single-image assets with PBR materials | Linux through WSL2 | 24 GB minimum | PBR GLB |

Forgecast runs only one heavyweight worker at a time. The local engine manager stops the previous worker before switching engines so their model weights do not compete for VRAM.

## Install on a Windows NVIDIA desktop

Recommended: NVIDIA RTX GPU, 24 GB VRAM for all three engines, 32 GB or more system RAM, current NVIDIA drivers, Git for Windows, Node.js 20+, Python 3.10, and WSL2 with Ubuntu 24.04 for TRELLIS.2. An RTX 4090 with 64 GB RAM is an excellent configuration.

```powershell
git clone https://github.com/yobender/Forgecast.git
cd Forgecast
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\setup-real-engine.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-hunyuan21.ps1
```

The installers clone pinned backend sources, create isolated Python environments, and download CUDA PyTorch. The Hunyuan3D 2.1 installer also builds the official Paint rasterizer with Visual Studio 2022 C++ tools and CUDA Toolkit 12.x. Model weights download on first use. Backend source, environments, weights, generated assets, and logs stay under the ignored `.runtime` directory.

Hunyuan3D 2.1 offers both **PBR color** and **Shape only** in the app. PBR mode generates the mesh, unloads the 10 GB Shape model, then loads the 21 GB Paint model to UV-unwrap the mesh and bake image-conditioned albedo plus metallic/roughness maps. Running the stages sequentially keeps them within a 24 GB GPU instead of requiring the upstream 29 GB combined footprint.

Forgecast replaces the expensive one-size-fits-all Paint defaults with three explicit cast profiles:

| Cast quality | Shape target | Paint pass | Texture | Recommended use |
| --- | ---: | --- | ---: | --- |
| Fast test | 20K triangles | 3 guided views at 320px | 1K | Check silhouette and approximate material placement |
| Balanced | 50K triangles | 4 guided views at 384px | 1K | Recommended everyday asset generation |
| Full quality | 100K triangles | 6 guided views at 512px | 2K | Final output after the shape has been approved |

All three profiles bake directly at their requested atlas size and skip the upstream redundant RealESRGAN expansion/downsample pass. This is designed to avoid the multi-hour Windows paint runs seen with the original 2K/4K intermediate settings. Complex thin structures can still require Balanced or Full geometry; Fast test is not intended as a final production mesh.

TRELLIS.2 is tested by Microsoft on Linux, so Forgecast runs it through a normal WSL2 Ubuntu distribution. Docker Desktop's internal distribution is not sufficient. Install and initialize Ubuntu first:

```powershell
wsl --install -d Ubuntu-24.04
wsl -d Ubuntu-24.04 -- sudo apt update
wsl -d Ubuntu-24.04 -- sudo apt install -y build-essential ninja-build git curl libgl1 libjpeg-dev zlib1g-dev
powershell -ExecutionPolicy Bypass -File .\scripts\setup-trellis2.ps1
```

Install NVIDIA's CUDA Toolkit 12.4 inside Ubuntu before running the TRELLIS.2 setup; the Windows display driver alone supplies GPU access but not the compiler required by TRELLIS.2's CUDA extensions. On Ubuntu 24.04, install `cuda-compiler-12-4` and `cuda-libraries-dev-12-4` from NVIDIA's WSL repository instead of the full toolkit meta-package, whose optional legacy profiler has an unavailable `libtinfo5` dependency. Follow [NVIDIA's CUDA on WSL guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html) and do not install a Linux display driver.

The complete three-engine runtime and checkpoints can use tens of gigabytes. Keep at least 80 GB free before installing every engine.

After installation, double-click `Start Forgecast.cmd`. It starts the private engine manager and interface, restores the last selected engine, then opens `http://127.0.0.1:5173`. Switching the engine in the interface safely replaces the active GPU worker.

For interface-only development:

```powershell
npm run dev
```

## Architecture direction

- React + TypeScript interface
- Three.js interactive preview and browser-side test exports
- Selectable Hunyuan3D Mini, Hunyuan3D 2.1, and TRELLIS.2 generation backends
- Single-active-worker isolation so heavyweight CUDA models can be restarted independently
- Exact-turntable multi-view fusion through the patched Mini engine
- Native PBR output through TRELLIS.2
- Local-only HTTP interface bound to `127.0.0.1`

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete request, worker, preview, history, and export flow.

When the AI backend is unavailable, Forgecast clearly falls back to procedural demo geometry. Demo exports are labeled and never presented as AI-generated assets.

## Legacy Mini engine details

The first real-engine milestone uses Hunyuan3D 2 Mini through a local Modly API. It generates a GLB from an attached PNG, JPG, or WEBP reference image. Prompt-only text-to-3D is not part of this milestone; a local concept-image stage is planned next.

Backend source, environments, model weights, generated assets, and logs stay under ignored local directories. They are intentionally not committed to GitHub. To reinstall the engine:

```powershell
.\scripts\setup-real-engine.ps1
.\scripts\start-real-engine.ps1
```

The backend listens only on `127.0.0.1:8765`. Forgecast detects it automatically; when it is unavailable, the app remains in clearly labeled demo mode.

Multi-view shape generation uses the official Hunyuan3D 2 multi-view checkpoint. If that checkpoint is incomplete, starting the real engine launches a hidden, resumable download to the D-drive runtime and the interface keeps fusion disabled until the verified file is ready.

## Baked art direction

`Polygon game` is the default production preset. It expands a user's notes into a consistent low-poly game-art recipe: chunky proportions, thumbnail-readable silhouettes, broad faceted planes, restrained color blocking, flat shading, the selected quality profile's triangle budget, and negative constraints against photorealism and noisy micro-detail. The complete resolved conditioning is included in every `.forgecast.json` recipe. The current real engines are image-conditioned, so they follow the supplied pixels; text-conditioned concept-image generation remains a planned stage.

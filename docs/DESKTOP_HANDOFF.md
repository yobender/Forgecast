# Forgecast desktop handoff

## Repository and branch

The current working branch is `codex/multi-engine-backend` in <https://github.com/yobender/Forgecast>. It contains the persistent asset library, laptop-safe Mini workflow, optional Quality Workshop, corrected Mini vertex colors, CPU game-mesh generation, refined STL export, Hunyuan3D 2.1 adapter, and TRELLIS.2 adapter.

Fresh checkout:

```powershell
git clone --branch codex/multi-engine-backend https://github.com/yobender/Forgecast.git
cd Forgecast
npm ci
```

Existing checkout:

```powershell
git fetch origin
git switch codex/multi-engine-backend
git pull --ff-only origin codex/multi-engine-backend
npm ci
```

Run the application with `Start Forgecast.cmd`.

## Local data is not in GitHub

`.runtime` is intentionally ignored. It contains generated GLBs, saved library models, logs, third-party engine checkouts, Python environments, and model weights. Pulling the repository recreates the code but does not transfer those files.

To keep laptop-generated casts, copy the laptop's `.runtime/library/models` directory to the same location in the desktop checkout while Forgecast is closed. Browser history and thumbnails are stored in the browser profile rather than Git, so copied GLBs may need a future library-index importer to appear automatically in the desktop UI. Do not commit `.runtime` or model checkpoints.

## Desktop engine setup

Requirements for the intended desktop are satisfied by an RTX 4090 and 64 GB system RAM. Install current NVIDIA drivers, Node.js 20+, Git for Windows, Python 3.10, Visual Studio 2022 C++ Build Tools, CUDA Toolkit 12.x, and WSL2 Ubuntu 24.04.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-real-engine.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-hunyuan21.ps1
```

For TRELLIS.2, initialize Ubuntu first and then run the dedicated installer:

```powershell
wsl --install -d Ubuntu-24.04
wsl -d Ubuntu-24.04 -- sudo apt update
wsl -d Ubuntu-24.04 -- sudo apt install -y build-essential ninja-build git curl libgl1 libjpeg-dev zlib1g-dev
powershell -ExecutionPolicy Bypass -File .\scripts\setup-trellis2.ps1
```

The full set of engines and checkpoints can consume more than 80 GB. The installers and workers bind only to local ports.

## Verify the checkout before generation

```powershell
npm ci
npm test
npm run test:mesh
npm run build
nvidia-smi
```

Expected code validation at this handoff: 29 application tests, 8 mesh-pipeline tests, and a successful production build.

## Current detail findings

The retained golem test source contains 1,199,312 triangles and dense vertex color, but no authored UV atlas or normal map. The new meshoptimizer 1.2 reducer relocates positions and attributes instead of only deleting triangles.

Measured results:

| Setting | Actual triangles | Maximum error | Reading |
| --- | ---: | ---: | --- |
| 25K Balanced | 25,000 | 1.44% | Visible softening |
| 50K Balanced | 50,000 | 0.66% | Good gameplay copy |
| 100K Balanced | 100,000 | 0.28% | Strong close-up copy |
| 25K Quality-first | 61,750 | 0.50% | Stops early to protect shape |

For the current source, use 100K for close views, 50K for a normal hero asset, and 25K as a later LOD. Quality-first is the safe default. The selected count is a target; Forgecast reports the actual result and measured quality.

## Recommended next development sequence

1. Test Hunyuan3D 2.1 Full PBR output on the 4090 and retain its UV-textured source GLB.
2. Test TRELLIS.2 on the same approved reference and compare geometry, materials, generation time, and VRAM use.
3. Add high-to-low baking: non-overlapping UV unwrap, source base-color projection, tangent-space normal bake, ambient occlusion, and texture padding.
4. Generate 100K/50K/25K LODs from the same baked hero asset so material detail remains stable while geometry changes.
5. Add a library import/index rebuild command for moving retained GLBs between computers.
6. Treat animation-ready topology as a separate retopology/rigging workflow; the present CPU reducer is for static game meshes.

See [Game mesh detail pipeline](game-mesh-detail.md), [Game mesh design](GAME_MESH.md), and [Architecture](ARCHITECTURE.md) for implementation details and limitations.

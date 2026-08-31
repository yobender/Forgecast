# Forgecast Studio

Forgecast is a local-first image-to-3D studio with selectable Hunyuan3D and TRELLIS backends. It supports single- and multi-reference inputs, geometry-aware presets, independent game mesh budgets, an interactive color/wireframe preview, persistent local assets, and GLB/STL/recipe exports.

## Forgecast 0.3 highlights

- Separate **Game asset** and **Print model** workflows.
- Independent reconstruction detail and 10K, 25K, 50K, or 100K game triangle budgets.
- Laptop-safe Hunyuan Mini profiles through a stable 384-grid/40-step Final reconstruction.
- CPU game-copy optimization with actual triangle counts, detail protection, and an untouched full-detail source.
- Geometry presets that change shape-guide preprocessing and mesh/export behavior.
- Persistent GLB library under `.runtime/library/models`, with generated thumbnails and legacy-output recovery.
- Search, rename, favorite, reopen, download, and confirmed deletion controls for saved casts.
- Real GLB inspection for triangles, vertices, disconnected parts, materials, file size, and watertight status.
- Detail-preserving STL repair, scale, component cleanup, and print-height export.

## Generation engines

| Engine | Best use | Platform | GPU memory | Output |
| --- | --- | --- | --- | --- |
| Hunyuan3D 2 Mini | Laptop drafts from one front reference | Windows | 8 GB minimum; 12 GB+ recommended | Vertex-color GLB |
| Hunyuan3D 2.1 | Single-image shape generation and guided PBR painting | Windows | About 10 GB shape / 21 GB paint | Shape or PBR GLB |
| TRELLIS.2 4B | Highest-fidelity single-image assets with PBR materials | Linux through WSL2 | 24 GB minimum | PBR GLB |

Forgecast runs only one heavyweight worker at a time. The local engine manager stops the previous worker before switching engines so their model weights do not compete for VRAM.

## Install on a Windows NVIDIA desktop

Recommended: NVIDIA RTX GPU, 24 GB VRAM for all three engines, 32 GB or more system RAM, current NVIDIA drivers, Git for Windows, Node.js 20+, Python 3.10, and WSL2 with Ubuntu 24.04 for TRELLIS.2. An RTX 4090 with 64 GB RAM is an excellent configuration.

The current development work is on `codex/multi-engine-backend`. For a new desktop checkout, clone that branch directly:

```powershell
git clone --branch codex/multi-engine-backend https://github.com/yobender/Forgecast.git
cd Forgecast
npm ci
powershell -ExecutionPolicy Bypass -File .\scripts\setup-real-engine.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\setup-hunyuan21.ps1
```

If the repository already exists on the desktop:

```powershell
git fetch origin
git switch codex/multi-engine-backend
git pull --ff-only origin codex/multi-engine-backend
npm ci
```

Then double-click `Start Forgecast.cmd`. See [Desktop handoff](docs/DESKTOP_HANDOFF.md) for runtime storage, verification commands, the current quality findings, and the recommended next implementation work.

The installers clone pinned backend sources, create isolated Python environments, and download CUDA PyTorch. The Hunyuan3D 2.1 installer also builds the official Paint rasterizer with Visual Studio 2022 C++ tools and CUDA Toolkit 12.x. Model weights download on first use. Backend source, environments, weights, generated assets, and logs stay under the ignored `.runtime` directory.

Hunyuan3D 2.1 offers both **PBR color** and **Shape only** in the app. PBR mode generates the mesh, unloads the 10 GB Shape model, then loads the 21 GB Paint model to UV-unwrap the mesh and bake image-conditioned albedo plus metallic/roughness maps. Running the stages sequentially keeps them within a 24 GB GPU instead of requiring the upstream 29 GB combined footprint.

Forgecast replaces the expensive one-size-fits-all Paint defaults with explicit reconstruction profiles. Reconstruction detail controls the shape-generation work; game output triangle count is selected independently in the interface.

| Reconstruction detail | Paint pass | Texture | Recommended use |
| --- | --- | ---: | --- |
| Fast test | 3 guided views at 320px | 1K | Check silhouette and approximate material placement |
| Balanced | 4 guided views at 384px | 1K | Recommended everyday asset generation |
| Full quality | 6 guided views at 512px | 2K | Final desktop output after the shape has been approved |

All profiles bake directly at their requested atlas size and skip the upstream redundant RealESRGAN expansion/downsample pass. This is designed to avoid the multi-hour Windows paint runs seen with the original 2K/4K intermediate settings. Complex thin structures can still require Balanced or Full geometry; Fast test is not intended as a final production mesh.

## Game and print output

**Single cast** is now the default: one Final-quality reconstruction is saved first, then Game asset output builds a separate reduced GLB on the CPU. Laptop-safe and desktop modes both offer 10K, 25K, 50K, and 100K targets because this post-process is CPU-based. These are useful starting budgets, not universal game-engine requirements. Both the source and game copy remain in the library.

To optimize an existing saved cast, open it, choose a **Game mesh budget** and **Detail protection**, then click **Build game copy from source**. No AI regeneration is needed. The reducer relocates surviving vertices while protecting normals, colors, UVs, tangents, borders, and regular triangle shape. The result shows measured input/output triangles, reduction, file size, source-detail capabilities, and an error-based shape-match rating; **View full-detail source** returns to the original. Repeated optimization starts from the saved source rather than repeatedly decimating an already reduced copy. The 100K close-up target is available in laptop mode because reduction runs in a CPU worker rather than the AI GPU. Restart Forgecast after updating so its manager loads the new mesh-job service.

**Quality-first** is the default protection mode. It may stop above the selected target when going lower would exceed the error limit. A target is a budget request, not a promise that every source can reach it cleanly. The current Hunyuan Mini source uses dense vertex color and often has no UV texture or normal map, so 25K can visibly soften armor edges. For the current 1.2M-triangle golem test, 50K is a useful general-game copy and 100K is the stronger close-up copy. See [Game mesh detail pipeline](docs/game-mesh-detail.md) for the measured results and next-stage texture-baking plan.

The reducer considers geometry, normals, vertex colors and UVs, locks mesh borders, preserves existing standard PBR materials/textures, and reports when protection prevents meeting a target. It does not use a destructive fallback just to claim the requested count. Fine relief, narrow color lines and small silhouettes may still change; inspect the result in orbit/wireframe at its intended game size. This is simplification, not animation-ready retopology, automatic LOD switching, or a new high-to-low normal-map bake. See [game-mesh design and validation](docs/GAME_MESH.md).

Legacy Mini files stored image-sRGB values directly in vertex-color channels, which GLB viewers interpret as linear. The viewer now corrects known Mini sources and shows vertex-color-only models with neutral unlit shading so highlights baked into the reference are not lit a second time. GLB download writes a separately tagged corrected-color copy when necessary. Already-corrected and native linear colors are not converted twice. Uncolored sources remain uncolored; color conversion cannot add a missing paint pass or remove highlights already projected from the reference.

Print output requests the raw reconstruction. Refined STL export repairs the **currently viewed** mesh, removes small floating components, scales to the requested millimeter height, and reports whether the result is watertight. Switch back to the full-detail source before STL export if inspecting a game copy. Refinement preserves existing geometry; it cannot invent omitted relief. STL has no color or normal-map detail.

## Quality Workshop

**Compare variations** is an optional Quality Workshop workflow, not the default. It performs three complete 384-grid, 40-step laptop casts with deterministic seed offsets so the user can choose the strongest geometry. Similar seeds can produce visually similar shapes; these are alternatives, not cumulative detail upgrades.

1. The front reference is inspected for resolution, aspect ratio, and suspiciously small/compressed input, then requires explicit approval.
2. Each candidate is generated sequentially and copied immediately into the persistent local library.
3. Forgecast captures a comparison image for every candidate while preserving the full generated mesh instead of applying the normal game triangle budget.
4. A collapsible **Shape comparison** tray below the viewport opens each real GLB in the main orbit and wireframe viewer without covering it. These are same-quality alternatives, not successive detail upgrades; differences may be subtle. Thumbnails use a separate fitted camera, independent of the user's zoom/pan.
5. The selected candidate is marked as a protected master and the tray automatically collapses. **Compare versions** reopens it; **View master** returns to the saved master after inspecting another candidate. Other candidates remain available in the library, and master metadata is retained beyond the normal recent-history window.

The protected master is never modified by export, game-copy optimization, or STL repair. Use **Build game copy from source** after selecting a master to create the lower-triangle derivative.

## Persistent asset library

Every successful local generation is copied away from the engine's working output and retained under `.runtime/library/models`. The browser history stores its local URL, generation recipe, compact thumbnail, display name, and favorite status. Clicking a saved cast restores both the model and its settings.

The engine manager exposes local-only endpoints for retained GLBs, inspection, download, recovery, and confirmed deletion. `backend/mesh_inspect.py` reads the archived GLB and reports actual geometry statistics instead of the requested target. Retained models are never committed to Git because `.runtime` remains ignored.

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
- Desktop-only, explicitly installed exact-turntable fusion through the patched Mini engine
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

Laptop-safe mode always submits only the front reference because loosely matched generated views routinely soften or distort Mini reconstructions. Other loaded views remain attached to the recipe as design references. Exact-turntable shape generation remains available as an advanced desktop experiment after manually running `scripts/install-multiview-model.ps1`; normal engine startup does not download its 4.9 GB checkpoint.

## Geometry presets

Forgecast's presets now control real reconstruction and export behavior instead of acting as visual-theme labels:

- `Miniature sculpt` keeps the raw print reconstruction and uses a detail-preserving shape guide.
- `Hard surface` edge-enhances plates, bevels and mechanical boundaries before reconstruction.
- `Organic` suppresses high-frequency image noise while preserving broad skin, cloth and creature forms.
- `Low poly` simplifies the shape guide, lowers the target mesh budget and uses flat preview shading.
- `Print-safe` closes narrow silhouette gaps and forces a watertight resample during refined STL export.

The resolved geometry profile is also included in every `.forgecast.json` recipe. These are still image-conditioned engines, so the reference views remain the strongest control over the subject's design.

`Final` is the slow laptop pass: it keeps Hunyuan Mini at the stable 384 grid and raises the diffusion work to 40 steps while retaining the raw print mesh. The STL refinement selector runs only during export; it repairs and preserves detail already present in the generated mesh, but cannot recreate relief that the shape model omitted.

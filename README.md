# Forgecast Studio

Forgecast is a local-first image-to-3D studio built around Hunyuan3D. It supports single- and multi-reference inputs, Polygon-game art direction, high-detail meshes, an interactive color/wireframe preview, automatic 2K PBR surface maps, and GLB/STL/recipe exports.

## Install on a Windows NVIDIA desktop

Recommended for the real local engine: NVIDIA RTX GPU, 12 GB or more VRAM, 32 GB system RAM, current NVIDIA drivers, Git for Windows, Node.js 20+, and Python 3.12. An RTX 4090 with 64 GB RAM is an excellent configuration.

```powershell
git clone https://github.com/yobender/Forgecast.git
cd Forgecast
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\setup-real-engine.ps1
```

The engine installer clones pinned backend sources, applies Forgecast's tested compatibility patches, creates isolated Python environments, and downloads CUDA PyTorch. Model weights download on first use. Allow roughly 25 GB of free disk space for the complete runtime and models.

After installation, double-click `Start Forgecast.cmd`. It starts both the private AI backend and interface, then opens `http://127.0.0.1:5173`. Run the launcher again whenever you need to restart Forgecast.

For interface-only development:

```powershell
npm run dev
```

## Architecture direction

- React + TypeScript interface
- Three.js interactive preview and browser-side test exports
- Local Hunyuan3D Mini generation backend with single-view and exact-turntable multi-view modes
- Python worker isolation so heavyweight CUDA models can be restarted independently
- Automatic projected UVs and embedded 2K color-detail, normal, roughness, and metallic maps
- Local-only HTTP interface bound to `127.0.0.1`

When the AI backend is unavailable, Forgecast clearly falls back to procedural demo geometry. Demo exports are labeled and never presented as AI-generated assets.

## Real local generation (optional, large install)

The first real-engine milestone uses Hunyuan3D 2 Mini through a local Modly API. It generates a GLB from an attached PNG, JPG, or WEBP reference image. Prompt-only text-to-3D is not part of this milestone; a local concept-image stage is planned next.

Backend source, environments, model weights, generated assets, and logs stay under ignored local directories. They are intentionally not committed to GitHub. To reinstall the engine:

```powershell
.\scripts\setup-real-engine.ps1
.\scripts\start-real-engine.ps1
```

The backend listens only on `127.0.0.1:8765`. Forgecast detects it automatically; when it is unavailable, the app remains in clearly labeled demo mode.

Multi-view shape generation uses the official Hunyuan3D 2 multi-view checkpoint. If that checkpoint is incomplete, starting the real engine launches a hidden, resumable download to the D-drive runtime and the interface keeps fusion disabled until the verified file is ready.

## Baked art direction

`Polygon game` is the default production preset. It expands a user's prompt with a consistent low-poly game-art recipe: chunky proportions, thumbnail-readable silhouettes, broad faceted planes, restrained color blocking, flat shading, a 5K preferred triangle budget, and negative constraints against photorealism and noisy micro-detail. The complete resolved conditioning is included in every `.forgecast.json` recipe so local AI backends receive the same art direction on every cast.

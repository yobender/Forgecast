# Forgecast architecture

Forgecast is a local React/TypeScript studio that treats image-to-3D models as replaceable workers. The browser owns the creative workflow and preview. Python owns GPU inference. A small Node process owns worker lifecycle.

## Request flow

1. `src/App.tsx` collects the prompt, synchronized reference set, style, quality, seed, and selected engine. Hunyuan Mini defaults to full fusion when multiple shape views are loaded; front-only behavior must be selected explicitly.
2. `src/engine/realEngines.ts` probes all engine health endpoints and asks the engine manager to activate the selected worker.
3. `scripts/engine-manager.mjs` stops the old worker, launches exactly one engine script, and writes logs under `.runtime/logs`.
4. The selected adapter submits a multipart generation job and polls its status.
5. The worker writes a GLB under `.runtime/forgecast-engine` and exposes it through a local-only output URL.
6. The engine manager copies completed output to `.runtime/library/models`, where worker restarts cannot remove it.
7. Single-cast game output submits the retained source to the CPU mesh worker and retains a linked reduced GLB. `AssetViewer` previews either copy and captures a fitted thumbnail; recipes remain `.forgecast.json` files. Legacy Mini color exports use a tagged corrected derivative, never a rewritten source.
8. The library inspector runs `backend/mesh_inspect.py` on demand and caches actual topology statistics beside the retained model.

## Workshop flow

Quality Workshop wraps the same honest engine call in approval and selection stages. Reference inspection runs in the browser before inference. The frontend then submits three final-quality jobs sequentially, maps each job's progress into one overall workshop percentage, and asks the manager to retain each successful output immediately. Candidate GLBs are never held only in a worker output directory.

This three-cast path is optional; the default is one Final cast followed by game-copy optimization for game output.

The viewer temporarily loads each retained candidate to capture its comparison thumbnail. After generation, candidate cards switch the main viewer between the real GLBs for orbit and wireframe inspection. Selecting a master changes persistent record metadata; it does not rewrite the GLB. Game reduction, STL repair, and later material stages must consume the master as an immutable source and write a separate derived file.

## CPU game mesh jobs

`POST /game-jobs` accepts only a retained UUID-style GLB filename and validated operation/options. A Node Worker runs `scripts/lib/game-mesh.mjs` off the manager event loop; `GET /game-jobs/:id` provides progress and actual output statistics. One CPU mesh operation runs at a time with a ten-minute timeout and 300 MB source-file limit. It never launches an AI worker. `FORGECAST_MANAGER_PORT` and `FORGECAST_NO_ENGINE_AUTOSTART=1` allow isolated service tests.

Attribute-aware meshoptimizer simplification considers normals, colors and UVs and locks mesh borders. The worker writes a new UUID GLB with exclusive creation and reports the original SHA-256. Standard embedded materials/textures and transforms survive; unsupported extensions, skins, animations, morphs and instancing are explicitly rejected rather than silently discarded. `sourceRecordId`, `meshRole`, `colorSpace` and `gameStats` link copies in browser history. No new normal-map baking or automatic animation topology is claimed.

## Engine boundaries

- **Hunyuan3D 2 Mini** uses the existing patched Modly service on port `8765`. Laptop-safe mode always uses one front reference and a maximum 384 reconstruction grid. Its exact-turntable checkpoint is an optional desktop-only experiment.
- **Hunyuan3D 2.1** uses `backend/hunyuan21_server.py` on port `8081`. The Forgecast worker imports only the official shape package, keeping the runtime near the upstream 10 GB shape-stage VRAM requirement. It does not claim PBR texture output.
- **TRELLIS.2** uses `backend/trellis2_server.py` on port `8766` inside WSL2. It exports the upstream O-Voxel result as a textured PBR GLB.
- **Engine manager** uses port `8764` and binds only to `127.0.0.1`. It owns worker lifecycle, persistent GLB storage, mesh inspection, and refined STL export; inference remains in the selected worker.

The frontend talks to a common asynchronous contract:

- `POST /generate` returns a `job_id`.
- `GET /status/{job_id}` reports `status`, `progress`, `stage`, and `step`.
- A completed job includes an `output_url` served by that worker.
- `GET /health` reports whether the service and model are loaded.

## Storage and source policy

Only Forgecast adapters, installers, reference assets, and documentation are committed. Third-party repositories, Python environments, Hugging Face checkpoints, retained/generated outputs, and logs live under `.runtime`, which is Git-ignored. Installers pin the reviewed upstream commits:

- Microsoft TRELLIS.2: `75fbf0183001ed9876c8dbb35de6b68552ee08bd`
- Tencent Hunyuan3D 2.1: `82920d643c0dc2f7bfd7255f45f62d386edfe60c`

TRELLIS.2's repository is MIT licensed. Hunyuan3D 2.1 uses Tencent's Hunyuan community license and carries notice and use restrictions. Review the upstream licenses before distributing Forgecast with model code or weights, or using generated assets in a commercial workflow.

## Failure behavior

If the manager or selected engine is unavailable, Forgecast remains usable in clearly labeled procedural demo mode. Installed workers show a starting state instead of silently running a demo. Engine errors are summarized in the UI while full process output remains in `.runtime/logs`.

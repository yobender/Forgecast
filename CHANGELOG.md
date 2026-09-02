# Changelog

## Unreleased

### Changed

- Default Hunyuan Mini multi-reference jobs to full fusion instead of silently submitting only the front image.
- Allow deliberate multi-view fusion in either performance profile and show the exact views sent to the engine.
- Add one-click, resumable installation of the optional 4.9 GB multi-view checkpoint.
- Blend adjacent multi-view color projections to reduce hard seams and improve side, rear, top, and bottom coverage.
- Label Hunyuan Mini output accurately as vertex color rather than implying that it contains a UV-textured PBR atlas.

- Default to one Final-quality cast; three-seed comparison is now optional.
- Game output retains the reconstruction before CPU simplification and keeps a separate, linked game GLB.
- Game copies report measured triangle counts, bytes and target shortfalls; source records remain retained while derivatives reference them.
- Correct legacy Mini image-sRGB vertex colors in previews and separately exported GLBs, without double-converting tagged/native linear colors.
- Preview vertex-color-only Mini assets with neutral unlit shading instead of adding a second set of glossy highlights over reference-baked lighting.
- Mesh switching now measures unscaled source bounds to avoid inherited preview scale/position.
- Relocate surviving positions and attributes during simplification, normalize the updated normals/tangents/colors, and preserve standard PBR materials/textures.
- Make the CPU-based 100K close-up game target available on laptops and default game copies to Quality-first protection.
- Report an error-based shape-match rating and whether the source has vertex colors, UV textures, or a normal map.
- Moved Quality Workshop comparisons into a collapsible tray below the 3D viewport; choosing a master collapses it automatically.
- Clarified that workshop casts are same-quality alternatives with different seeds, not progressive detail passes.
- Candidate previews now contain the whole thumbnail instead of cropping it, with separate viewing/master labels and a return-to-master action.
- New model thumbnails use an independently fitted camera rather than copying the user's zoomed/panned viewport.
- Recipe export keeps the actual saved-master ID when inspecting other candidates.
- Reopening a saved workshop cast restores its available comparison group without rerunning generation.

### Added

- 10K/25K/50K/100K CPU game-copy targets and Quality-first/Balanced/Budget-first detail protection.
- Local asynchronous mesh jobs using pinned meshoptimizer and glTF Transform; no new GPU model or Blender installation.
- Tests for triangle reduction, immutable sources, color encoding, embedded texture/UV preservation, protected history, and unsupported/topology-limited meshes.

## 0.3.1 - 2026-08-27

### Changed

- Laptop-safe generation now always uses one front reference; multi-view fusion is an explicit desktop experiment.
- Laptop reconstruction is capped at a stable 384 grid, with 10/20/30/40-step Draft through Final profiles.
- Laptop game exports are capped at 50K triangles instead of presenting a misleading 100K option.
- Hunyuan Mini output is correctly labeled as vertex-color GLB rather than PBR.
- Real GLB export downloads the retained engine file without replacing or fabricating its materials.
- Starting the laptop engine no longer downloads the optional 4.9 GB multi-view checkpoint automatically.

### Added

- Quality Workshop with front-reference inspection and explicit approval before GPU work begins.
- Three sequential 384-grid/40-step laptop candidates using deterministic seed offsets.
- Immediate disk retention and comparison thumbnails for every completed candidate.
- Candidate review in the main orbit/wireframe viewer and explicit protected-master selection.
- Workshop metadata in the persistent asset library, including candidate number and protected-master status.

## 0.3.0 - 2026-08-26

### Added

- Persistent local GLB asset library with thumbnails and legacy-output recovery.
- Search, rename, favorite, download, reopen, and confirmed deletion controls.
- Actual retained-mesh inspection for topology, file size, parts, materials, and watertight status.
- Separate game-asset and print-model workflows.
- Independent 10K, 25K, 50K, and 100K game mesh budgets.
- Ultra laptop reconstruction profile and stronger detail-preserving shape guides.
- Geometry presets for miniature, hard-surface, organic, low-poly, and print-safe output.
- Multi-reference drag-and-drop with front-priority and exact-turntable fusion modes.

### Improved

- Detail-preserving STL repair, scaling, component filtering, and watertight reporting.
- Color-aware preview materials, native/generated normals, wireframe visibility, and stable model loading.
- Progress reporting, worker recovery, GPU release, and high-detail generation timeouts.
- UI organization, output terminology, advanced engine controls, and game-ready budget feedback.

### Fixed

- Viewer model reloads and geometry blinking during engine polling.
- Missing color caused by absent normals or preview material replacement.
- Multi-view image preprocessing failures and long-running generation timeout handling.
- Fine-detail settings that previously implied the exporter could recreate missing geometry.

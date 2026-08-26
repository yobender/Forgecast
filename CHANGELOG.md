# Changelog

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

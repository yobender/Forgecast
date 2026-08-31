# Low-triangle game copies

## Decision

Keep the dense reconstruction as a source, then simplify a separate copy using the CPU. Reconstruction quality and runtime triangle count are separate concerns. A dense source is useful for printing and later baking, but should not be mistaken for the game mesh.

We use [meshoptimizer's attribute-aware simplifier](https://github.com/zeux/meshoptimizer/blob/v0.22/js/README.md), pinned to 0.22.0, with normals weighted 0.5, vertex colors 2.0, and UV channels 0.5. Open borders are locked. Strict/Balanced/Flexible set approximate appearance-error limits of 0.005/0.02/0.05. These are algorithmic error estimates, not guaranteed visual similarity percentages. Targets are allocated across primitives; topology or error limits may stop above the budget. No sloppy fallback is used.

[glTF Transform NodeIO](https://gltf-transform.dev/modules/core/classes/NodeIO) keeps standard embedded textures, material factors, vertex attributes and node transforms. Authored normals are retained; estimated normals guide reduction and are recalculated on the final topology for un-authored sources. Unsupported formats fail without changing the source.

## Color

The Mini reference projector supplied image-sRGB bytes as vertex colors. [glTF vertex colors are linear multipliers](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), consistent with [Three.js color management](https://threejs.org/manual/en/color-management.html). Known legacy Mini sources are linearized on cloned preview geometry and separately generated GLBs. Vertex-color-only sources use a neutral unlit preview because their source reference already contains lighting; PBR assets keep authored lighting materials. Tagged corrected copies and native linear sources are not converted twice. Alpha and original source bytes remain unchanged. This fixes encoding and double-lighting, not missing colors, poor projection coverage, or white highlights already projected from the reference.

## Verified local golem, 2026-08-31

One retained cast had 1,215,320 triangles and 24,307,464 bytes. Balanced protection produced:

| Target | Actual triangles | GLB bytes | Reduction |
| --- | ---: | ---: | ---: |
| 10K | 19,598 (protection stop) | 510,676 | 98.39% |
| 25K | 25,000 | 651,132 | 97.94% |
| 50K | 50,000 | 1,301,132 | 95.89% |

The source SHA-256 stayed `3da859bdbe8bd277e30051012ed357ffb24ef6a5882ee555d1dbfca86cb5dc48`. These are one-asset measurements, not a guarantee for every model. Reduced copies keep the main outline and broad color regions but lose fine color lines and surface relief compared with the source. They are not visually lossless replacements. Test at the intended camera distance and compare higher budgets before accepting an asset.

## Next quality stage: bake detail, not triangles

High-to-low normal and color baking is **not implemented** by this pass. For closer visual fidelity, unwrap the low mesh, transfer dense-source color to an albedo atlas, and bake source normals to a tangent-space normal map with padding and a checked ray cage. This is the direction described by [Blender's baking workflow](https://docs.blender.org/manual/en/latest/render/cycles/baking.html). Normal maps retain lighting detail without adding triangles, but cannot restore an altered silhouette or add actual relief to an STL. Vertex colors alone lose sampling density as vertices are removed.

Animation-ready characters still need deliberate deformation topology, rigging and weight checks. LOD bundles and engine import validation remain separate follow-ups. Existing PBR maps are retained, not regenerated.

## Verification

- `npm test`: UI helpers, color conversion, source history and existing app regression tests.
- `npm run test:mesh`: real simplification, byte-preserved sources, transforms, RGBA conversion/no double conversion, UVs/embedded textures/material factors, unsupported input and refusal of destructive topology fallback.
- Isolated manager jobs validate budget/filename restrictions and actual exported geometry.
- Browser inspection compares the same retained GLBs with fixed lighting and stable source-relative framing.

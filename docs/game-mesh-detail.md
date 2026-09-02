# Forgecast game-mesh detail pipeline

## What the source actually contains

Hunyuan3D Mini currently gives Forgecast a dense static GLB with geometry and vertex color. The inspected golem source contains 1,199,312 triangles and 599,646 vertices, but no authored UV atlas or baked normal map. Its fine appearance is therefore tied to dense geometry and dense vertex-color samples. Removing 98% of those vertices removes both shape samples and color samples.

STL is a different target: it carries physical geometry, not game shading. A normal map can make a low-triangle GLB look detailed in a game, but cannot create printable relief in an STL.

## Implemented now

The game-copy worker uses meshoptimizer 1.2 attribute-aware simplification with vertex relocation. It jointly updates positions, normals, colors, UVs, and tangents, locks open borders, and lightly regularizes triangles. The original saved GLB stays immutable and every game copy is produced from that master.

The UI exposes four roles rather than claiming one universal count:

- 10K: distant LOD or simple prop; aggressive for a generated character.
- 25K: normal game target; requires a bake for convincing close-up relief.
- 50K: hero model compromise.
- 100K: close-up model; CPU-safe on the laptop.

Quality-first protection is intentionally allowed to stop above a selected target. Forgecast reports the actual triangle count and normalized simplification error.

Measured on the retained 1.2M-triangle golem:

| Setting | Actual triangles | Maximum error | Practical reading |
| --- | ---: | ---: | --- |
| 25K Balanced | 25,000 | 1.44% | Visible softening |
| 50K Balanced | 50,000 | 0.66% | Good general-game copy |
| 100K Balanced | 100,000 | 0.28% | Close visual match |
| 25K Quality-first | 61,750 | 0.50% | Stops early to protect detail |

## Highest-impact next stage

The missing stage is high-to-low baking:

1. Generate a non-overlapping UV atlas for the chosen low mesh.
2. Project source color onto a base-color texture instead of depending on sparse low-mesh vertex colors.
3. Project dense source normals into a tangent-space normal map.
4. Add ambient-occlusion and optional height maps.
5. Generate 50K and 25K LODs from the same textured hero mesh so all LODs share material detail.

This preserves surface shading between vertices, but it cannot preserve silhouette detail, repair missing back/top information in a single reference, or create animation-ready edge loops. A character that must deform still needs dedicated retopology and rigging.

## Technical references

- meshoptimizer simplification and attribute-aware vertex updates: <https://github.com/zeux/meshoptimizer>
- xatlas UV unwrapping for lightmaps and texture baking: <https://github.com/jpcy/xatlas>
- glTF Transform unwrap support: <https://github.com/donmccurdy/glTF-Transform>
- glTF 2.0 tangent-space normal texture definition: <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html>
- Blender high-to-low baking: <https://docs.blender.org/manual/en/latest/render/cycles/baking.html>

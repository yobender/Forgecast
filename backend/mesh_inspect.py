"""Read stable, game-relevant statistics from a retained Forgecast GLB."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh


def inspect_mesh(path: Path) -> dict[str, object]:
    loaded = trimesh.load(path, force="scene")
    geometries = [geometry for geometry in loaded.geometry.values() if isinstance(geometry, trimesh.Trimesh)]
    if not geometries:
        raise ValueError("The GLB does not contain triangle geometry")

    mesh = trimesh.util.concatenate(tuple(geometries))
    extents = np.asarray(mesh.extents, dtype=float)
    try:
        component_count = len(mesh.split(only_watertight=False))
    except ImportError:
        # Minimal Forgecast environments may omit networkx/scipy. The source
        # scene geometry count remains a useful conservative part count.
        component_count = len(geometries)
    materials = {
        str(getattr(getattr(geometry.visual, "material", None), "name", "Material"))
        for geometry in geometries
    }
    return {
        "vertices": int(len(mesh.vertices)),
        "triangles": int(len(mesh.faces)),
        "meshes": int(len(geometries)),
        "components": int(component_count),
        "materials": int(len(materials)),
        "watertight": bool(mesh.is_watertight),
        "extents": [round(float(value), 4) for value in extents],
        "surfaceArea": round(float(mesh.area), 4),
        "fileBytes": int(path.stat().st_size),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_mesh(args.input.resolve())))


if __name__ == "__main__":
    main()

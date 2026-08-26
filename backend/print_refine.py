"""Repair and scale a generated GLB for reliable, detail-preserving STL output."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import trimesh

try:
    import pymeshlab
except ImportError:  # The Trimesh repair path still provides a useful export.
    pymeshlab = None


def _scene_to_mesh(loaded: trimesh.Trimesh | trimesh.Scene) -> trimesh.Trimesh:
    if isinstance(loaded, trimesh.Trimesh):
        return loaded.copy()
    geometries: list[trimesh.Trimesh] = []
    for node_name in loaded.graph.nodes_geometry:
        transform, geometry_name = loaded.graph[node_name]
        geometry = loaded.geometry[geometry_name].copy()
        geometry.apply_transform(transform)
        geometries.append(geometry)
    if not geometries:
        raise ValueError("The generated file contains no triangle geometry.")
    return trimesh.util.concatenate(geometries)


def _remove_floaters(mesh: trimesh.Trimesh, profile: str) -> tuple[trimesh.Trimesh, int]:
    faces = np.asarray(mesh.faces)
    if len(faces) == 0:
        return mesh, 0
    # The lightweight Modly environment intentionally omits NetworkX/Scipy,
    # so use a compact union-find over faces that share vertices.
    parent = np.arange(len(faces), dtype=np.int64)
    owner = np.full(len(mesh.vertices), -1, dtype=np.int64)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = int(parent[index])
        return index

    def union(first: int, second: int) -> None:
        first_root, second_root = find(first), find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    for face_index, face in enumerate(faces):
        for vertex_index in face:
            previous = int(owner[vertex_index])
            if previous >= 0:
                union(face_index, previous)
            else:
                owner[vertex_index] = face_index

    roots = np.fromiter((find(index) for index in range(len(faces))), dtype=np.int64, count=len(faces))
    unique_roots, counts = np.unique(roots, return_counts=True)
    if len(unique_roots) <= 1:
        return mesh, 0
    largest = int(counts.max())
    fraction = 0.001 if profile == "fine" else 0.004
    minimum_faces = max(12 if profile == "fine" else 24, math.ceil(largest * fraction))
    kept_roots = unique_roots[counts >= minimum_faces]
    if len(kept_roots) == 0:
        kept_roots = np.asarray([unique_roots[int(np.argmax(counts))]])
    kept_faces = faces[np.isin(roots, kept_roots)]
    result = trimesh.Trimesh(vertices=np.asarray(mesh.vertices).copy(), faces=kept_faces, process=False)
    result.remove_unreferenced_vertices()
    return result, int(len(unique_roots) - len(kept_roots))


def _pymeshlab_repair(mesh: trimesh.Trimesh, profile: str) -> trimesh.Trimesh:
    if pymeshlab is None:
        return mesh
    mesh_set = pymeshlab.MeshSet()
    mesh_set.add_mesh(pymeshlab.Mesh(
        vertex_matrix=np.asarray(mesh.vertices, dtype=np.float64),
        face_matrix=np.asarray(mesh.faces, dtype=np.int32),
    ))
    filters = (
        ("meshing_merge_close_vertices", {}),
        ("meshing_remove_duplicate_faces", {}),
        ("meshing_remove_unreferenced_vertices", {}),
        ("meshing_repair_non_manifold_edges", {"method": 0}),
        ("meshing_repair_non_manifold_vertices", {}),
        ("meshing_close_holes", {
            "maxholesize": 120 if profile == "fine" else 80,
            "selfintersection": True,
            "refinehole": profile == "fine",
        }),
        ("meshing_re_orient_faces_coherently", {}),
        ("meshing_remove_unreferenced_vertices", {}),
    )
    for filter_name, parameters in filters:
        try:
            mesh_set.apply_filter(filter_name, **parameters)
        except Exception as error:  # One failed repair must not lose the export.
            print(f"[print-refine] {filter_name} skipped: {error}")
    repaired = mesh_set.current_mesh()
    return trimesh.Trimesh(
        vertices=np.asarray(repaired.vertex_matrix()),
        faces=np.asarray(repaired.face_matrix()),
        process=False,
    )


def _watertight_remesh(mesh: trimesh.Trimesh, cell_size_mm: float) -> trimesh.Trimesh:
    """Use MeshLab's uniform resampler only when ordinary repair leaves holes."""
    if pymeshlab is None:
        return mesh
    mesh_set = pymeshlab.MeshSet()
    mesh_set.add_mesh(pymeshlab.Mesh(
        vertex_matrix=np.asarray(mesh.vertices, dtype=np.float64),
        face_matrix=np.asarray(mesh.faces, dtype=np.int32),
    ))
    try:
        mesh_set.apply_filter(
            "generate_resampled_uniform_mesh",
            cellsize=pymeshlab.PureValue(cell_size_mm),
            offset=pymeshlab.PureValue(0.0),
            mergeclosevert=True,
            multisample=True,
            absdist=False,
        )
        remeshed = mesh_set.current_mesh()
        result = trimesh.Trimesh(
            vertices=np.asarray(remeshed.vertex_matrix()),
            faces=np.asarray(remeshed.face_matrix()),
            process=False,
        )
        result.remove_unreferenced_vertices()
        return result if len(result.faces) else mesh
    except Exception as error:
        print(f"[print-refine] Watertight remesh skipped: {error}")
        return mesh


GEOMETRY_PRESETS = {"miniature-sculpt", "hard-surface", "organic", "low-poly", "print-safe"}


def refine_mesh(
    input_path: Path,
    target_height_mm: float,
    profile: str,
    geometry_preset: str = "miniature-sculpt",
) -> tuple[trimesh.Trimesh, dict[str, object]]:
    if geometry_preset not in GEOMETRY_PRESETS:
        raise ValueError(f"Unknown geometry preset: {geometry_preset}")
    loaded = trimesh.load(input_path, process=False)
    mesh = _scene_to_mesh(loaded)
    input_faces = len(mesh.faces)
    mesh.remove_infinite_values()
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    floater_profile = "balanced" if geometry_preset == "print-safe" else profile
    mesh, removed_components = _remove_floaters(mesh, floater_profile)
    mesh = _pymeshlab_repair(mesh, profile)
    mesh.remove_infinite_values()
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    try:
        trimesh.repair.fill_holes(mesh)
    except Exception as error:
        print(f"[print-refine] Final hole repair skipped: {error}")

    # Hunyuan/Three.js are Y-up; slicers expect Z-up. Rotate onto the build
    # plate, scale to a real millimeter height, center XY, and place Z at zero.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2.0, [1.0, 0.0, 0.0]))
    bounds = mesh.bounds
    height = float(bounds[1, 2] - bounds[0, 2])
    if not math.isfinite(height) or height <= 1e-8:
        raise ValueError("The generated mesh has no measurable height.")
    mesh.apply_scale(target_height_mm / height)
    bounds = mesh.bounds
    center_xy = (bounds[0, :2] + bounds[1, :2]) / 2.0
    mesh.apply_translation([-center_xy[0], -center_xy[1], -bounds[0, 2]])

    watertight_remesh = False
    if geometry_preset == "print-safe":
        cell_size_mm = max(0.14, target_height_mm / 400)
    else:
        cell_size_mm = max(0.1 if profile == "fine" else 0.16, target_height_mm / (500 if profile == "fine" else 350))
    force_watertight_remesh = geometry_preset == "print-safe"
    if force_watertight_remesh or not mesh.is_watertight:
        mesh = _watertight_remesh(mesh, cell_size_mm)
        watertight_remesh = True
        bounds = mesh.bounds
        center_xy = (bounds[0, :2] + bounds[1, :2]) / 2.0
        mesh.apply_translation([-center_xy[0], -center_xy[1], -bounds[0, 2]])

    stats: dict[str, object] = {
        "inputFaces": input_faces,
        "outputFaces": len(mesh.faces),
        "removedComponents": removed_components,
        "watertight": bool(mesh.is_watertight),
        "watertightRemesh": watertight_remesh,
        "detailCellMm": round(cell_size_mm, 4) if watertight_remesh else None,
        "heightMm": round(float(mesh.extents[2]), 3),
        "profile": profile,
        "geometryPreset": geometry_preset,
        "forcedWatertightRemesh": force_watertight_remesh,
    }
    return mesh, stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--height-mm", required=True, type=float)
    parser.add_argument("--profile", choices=("balanced", "fine"), default="fine")
    parser.add_argument("--geometry-preset", choices=tuple(sorted(GEOMETRY_PRESETS)), default="miniature-sculpt")
    args = parser.parse_args()
    if not 10 <= args.height_mm <= 500:
        raise ValueError("Print height must be between 10 and 500 mm.")
    mesh, stats = refine_mesh(args.input, args.height_mm, args.profile, args.geometry_preset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(args.output, file_type="stl")
    print(json.dumps(stats, separators=(",", ":")))


if __name__ == "__main__":
    main()

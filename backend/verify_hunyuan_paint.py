"""Import-only verification for the Forgecast Hunyuan3D Paint runtime."""

from __future__ import annotations

import argparse
import sys
import types
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    args = parser.parse_args()

    source = Path(args.source).resolve()
    for source_path in (
        source,
        source / "hy3dpaint",
        source / "hy3dpaint" / "custom_rasterizer",
    ):
        sys.path.insert(0, str(source_path))

    from torchvision_fix import apply_fix

    apply_fix()
    sys.modules.setdefault("bpy", types.ModuleType("bpy"))
    import custom_rasterizer  # noqa: F401
    import custom_rasterizer_kernel  # noqa: F401
    import realesrgan  # noqa: F401
    from DifferentiableRenderer.mesh_inpaint_processor import meshVerticeInpaint  # noqa: F401
    from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline  # noqa: F401

    print("Hunyuan3D Paint imports verified")


if __name__ == "__main__":
    main()

"""Build Hunyuan3D-Paint's pybind11 mesh inpainting helper on Windows."""

from __future__ import annotations

import argparse
from pathlib import Path

from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import setup


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--temp", required=True)
    args = parser.parse_args()

    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    temp = Path(args.temp).resolve()
    output.mkdir(parents=True, exist_ok=True)
    temp.mkdir(parents=True, exist_ok=True)

    setup(
        name="forgecast-hunyuan-mesh-inpaint",
        ext_modules=[Pybind11Extension("mesh_inpaint_processor", [str(source)], cxx_std=11)],
        cmdclass={"build_ext": build_ext},
        script_args=["build_ext", "--build-lib", str(output), "--build-temp", str(temp)],
    )


if __name__ == "__main__":
    main()

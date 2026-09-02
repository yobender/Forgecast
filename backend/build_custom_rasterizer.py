"""Build Hunyuan3D-Paint's Windows CUDA rasterizer without editing upstream."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from setuptools import setup
from torch.utils.cpp_extension import BuildExtension, CUDAExtension


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--temp", required=True)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    temp = Path(args.temp).resolve()
    source = root / "lib" / "custom_rasterizer_kernel_for_windows"
    patched_source = temp / "source"
    objects = temp / "objects"
    patched_source.mkdir(parents=True, exist_ok=True)
    objects.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, patched_source, dirs_exist_ok=True)

    grid_path = patched_source / "grid_neighbor.cpp"
    grid_source = grid_path.read_text(encoding="utf-8")
    even_allocation = (
        "        grid_evencorners[i] = torch::zeros({static_cast<int64_t>"
        "(grids[i].seq2evencorner.size())}, int64_options);"
    )
    odd_allocation = (
        "\n        grid_oddcorners[i] = torch::zeros({static_cast<int64_t>"
        "(grids[i].seq2oddcorner.size())}, int64_options);"
    )
    if grid_source.count(even_allocation) != 2:
        raise RuntimeError("Unexpected upstream Windows rasterizer source; allocation patch was not applied.")
    grid_path.write_text(grid_source.replace(even_allocation, even_allocation + odd_allocation), encoding="utf-8")

    rasterizer_gpu_path = patched_source / "rasterizer_gpu.cu"
    rasterizer_gpu_source = rasterizer_gpu_path.read_text(encoding="utf-8")
    unsigned_pointer = "z_min.data_ptr<uint64_t>()"
    signed_pointer = "z_min.data_ptr<int64_t>()"
    if rasterizer_gpu_source.count(unsigned_pointer) != 3:
        raise RuntimeError("Unexpected upstream Windows rasterizer source; int64 pointer patch was not applied.")
    rasterizer_gpu_path.write_text(
        rasterizer_gpu_source.replace(unsigned_pointer, signed_pointer),
        encoding="utf-8",
    )

    setup(
        name="forgecast-hunyuan-custom-rasterizer",
        ext_modules=[
            CUDAExtension(
                "custom_rasterizer_kernel",
                [
                    str(patched_source / "rasterizer.cpp"),
                    str(patched_source / "grid_neighbor.cpp"),
                    str(patched_source / "rasterizer_gpu.cu"),
                ],
            )
        ],
        cmdclass={"build_ext": BuildExtension},
        script_args=["build_ext", "--build-lib", str(root), "--build-temp", str(objects)],
    )


if __name__ == "__main__":
    main()

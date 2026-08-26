import tempfile
import unittest
from pathlib import Path

import trimesh

from backend.print_refine import refine_mesh


class PrintRefineTests(unittest.TestCase):
    def test_scales_orients_and_removes_a_tiny_floater(self):
        body = trimesh.creation.box(extents=(1.0, 2.0, 0.5))
        floater = trimesh.creation.icosphere(subdivisions=0, radius=0.01)
        floater.apply_translation((5.0, 5.0, 5.0))
        scene = trimesh.Scene([body, floater])
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.glb"
            scene.export(source)
            result, stats = refine_mesh(source, 75.0, "balanced")
        self.assertAlmostEqual(result.extents[2], 75.0, places=3)
        self.assertAlmostEqual(result.bounds[0, 2], 0.0, places=5)
        self.assertEqual(stats["removedComponents"], 1)
        self.assertGreater(stats["outputFaces"], 0)
        self.assertTrue(stats["watertight"])


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path

import plot_lock_recording as plotter


class TestPlotLockRecording(unittest.TestCase):
    def test_discovers_recording_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            event = root / "run" / "event"
            event.mkdir(parents=True)
            (event / "metadata.json").write_text('{"run_name":"run"}\n', encoding="utf-8")

            self.assertEqual(plotter.discover_recording_dirs(root), [event])
            self.assertEqual(plotter.discover_recording_dirs(event), [event])

    def test_reads_numeric_csv_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference_spectrum.csv"
            path.write_text(
                "index,ch1_current_mA,adc_count,label\n"
                "0,1.25,65000,a\n"
                "1,1.50,64900,b\n",
                encoding="utf-8",
            )

            rows = plotter.read_csv_rows(path)
            self.assertEqual(rows[0]["index"], 0)
            self.assertEqual(rows[1]["ch1_current_mA"], 1.5)
            self.assertEqual(rows[0]["label"], "a")

    def test_safe_output_directory_defaults_to_plots_subdir(self):
        event = Path("/tmp/example_event")
        self.assertEqual(plotter.resolve_output_dir(event, None), event / "plots")


if __name__ == "__main__":
    unittest.main()

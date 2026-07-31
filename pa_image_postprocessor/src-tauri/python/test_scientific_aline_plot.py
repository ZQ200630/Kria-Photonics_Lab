import io
import unittest

from scientific_aline_plot import build_figure, render_png


PAYLOAD = {
    "time_ns": [0.0, 1000.0, 2000.0, 3000.0],
    "frame_index": 42,
    "visible_domain": {"start_index": 1, "end_index": 2},
    "series": [
        {
            "label": "Raw current",
            "color": "#0F4D92",
            "values": [-1.0, 2.0, -3.0, 4.0],
            "x_offset": 0,
        },
        {
            "label": "Filtered RF",
            "color": "#9A4D8E",
            "values": [10.0, 20.0],
            "x_offset": 1,
        },
    ],
}


class ScientificAlinePlotTests(unittest.TestCase):
    def test_builds_nature_style_axes_with_prominent_labels_and_legend(self):
        figure, axis = build_figure(PAYLOAD)
        self.addCleanup(figure.clear)

        self.assertEqual(figure.get_size_inches().tolist(), [8.0, 5.0])
        self.assertEqual(axis.get_xlabel(), "Time (µs)")
        self.assertEqual(axis.get_ylabel(), "Current (µA)")
        self.assertGreaterEqual(axis.xaxis.label.get_fontsize(), 24)
        self.assertGreaterEqual(axis.yaxis.label.get_fontsize(), 24)
        self.assertFalse(axis.spines["top"].get_visible())
        self.assertFalse(axis.spines["right"].get_visible())
        legend = axis.get_legend()
        self.assertIsNotNone(legend)
        self.assertTrue(all(text.get_fontsize() >= 18 for text in legend.get_texts()))
        legend_anchor = legend.get_bbox_to_anchor().transformed(axis.transAxes.inverted())
        self.assertGreaterEqual(legend_anchor.y0, 1.0)
        self.assertEqual(axis.lines[0].get_xdata().tolist(), [1.0, 2.0])
        self.assertEqual(axis.lines[1].get_xdata().tolist(), [1.0, 2.0])

    def test_renders_a_real_2400_by_1500_png(self):
        png = render_png(PAYLOAD)

        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(int.from_bytes(png[16:20], "big"), 2400)
        self.assertEqual(int.from_bytes(png[20:24], "big"), 1500)
        self.assertGreater(len(png), 10_000)

    def test_preserves_visible_time_range_when_only_offset_series_is_selected(self):
        payload = {
            **PAYLOAD,
            "visible_domain": {"start_index": 0, "end_index": 3},
            "series": [PAYLOAD["series"][1]],
        }

        figure, axis = build_figure(payload)
        self.addCleanup(figure.clear)

        self.assertEqual(axis.get_xlim(), (0.0, 3.0))


if __name__ == "__main__":
    unittest.main()

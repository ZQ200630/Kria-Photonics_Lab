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

        self.assertEqual(figure.get_size_inches().tolist(), [8.0, 4.0])
        self.assertEqual(axis.get_xlabel(), "Time (µs)")
        self.assertEqual(axis.get_ylabel(), "Current (µA)")
        self.assertGreaterEqual(axis.xaxis.label.get_fontsize(), 24)
        self.assertGreaterEqual(axis.yaxis.label.get_fontsize(), 24)
        self.assertFalse(axis.spines["top"].get_visible())
        self.assertFalse(axis.spines["right"].get_visible())
        legend = axis.get_legend() or figure.legends[0]
        self.assertIsNotNone(legend)
        self.assertTrue(all(text.get_fontsize() == 13 for text in legend.get_texts()))
        self.assertTrue(all(line.get_linewidth() == 1.5 for line in axis.lines))
        self.assertEqual(axis.lines[0].get_xdata().tolist(), [1.0, 2.0])
        self.assertEqual(axis.lines[1].get_xdata().tolist(), [1.0, 2.0])

    def test_four_item_legend_stays_inside_the_figure(self):
        payload = {
            **PAYLOAD,
            "series": [
                PAYLOAD["series"][0],
                {
                    "label": "Baseline-corrected",
                    "color": "#42949E",
                    "values": [-1.0, 2.0, -3.0, 4.0],
                    "x_offset": 0,
                },
                PAYLOAD["series"][1],
                {
                    "label": "Hilbert envelope",
                    "color": "#B64342",
                    "values": [8.0, 12.0],
                    "x_offset": 1,
                },
            ],
        }
        figure, axis = build_figure(payload)
        self.addCleanup(figure.clear)
        figure.canvas.draw()
        legend = axis.get_legend() or figure.legends[0]
        bounds = legend.get_window_extent(figure.canvas.get_renderer())

        self.assertGreaterEqual(bounds.x0, figure.bbox.x0)
        self.assertLessEqual(bounds.x1, figure.bbox.x1)

    def test_renders_a_real_2400_by_1200_png(self):
        png = render_png(PAYLOAD)

        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(int.from_bytes(png[16:20], "big"), 2400)
        self.assertEqual(int.from_bytes(png[20:24], "big"), 1200)
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

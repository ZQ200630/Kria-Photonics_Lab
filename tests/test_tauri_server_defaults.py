import unittest

import butterfly_laser_server as legacy
import butterfly_laser_server_tauri as tauri_server


class TauriServerDefaultsTests(unittest.TestCase):
    def test_tauri_server_reuses_legacy_defaults(self):
        self.assertIs(tauri_server.DEFAULT_SETTINGS, legacy.DEFAULT_SETTINGS)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["max_step"], "3")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["integral_limit"], "500000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["locked_threshold"], "1000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["loss_threshold"], "10000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["lp_shift"], "13")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["enabled"], True)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["rate_c_per_s"], "0.05")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["interval_ms"], "200")


if __name__ == "__main__":
    unittest.main()

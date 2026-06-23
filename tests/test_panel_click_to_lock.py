from pathlib import Path
import json
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "butterfly_laser_panel.html"
ADA_AXI = Path(
    "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/"
    "axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0_S00_AXI.v"
)
LASER_AXI = Path(
    "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/"
    "axi_laser_current_ctrl_1_0/hdl/axi_laser_current_ctrl_v1_0_S00_AXI.v"
)
sys.path.insert(0, str(ROOT))


class ClickToLockPanelTests(unittest.TestCase):
    def test_click_to_lock_arm_control_exists(self):
        html = PANEL.read_text(encoding="utf-8")
        self.assertIn('id="lockClickToLockArm"', html)
        self.assertIn("Arm Click-to-Lock", html)
        self.assertIn('id="lockClickStatus"', html)

    def test_spectrum_click_can_start_lock_when_armed(self):
        html = PANEL.read_text(encoding="utf-8")
        self.assertIn("function setClickToLockArmed", html)
        self.assertIn("checked('lockClickToLockArm')", html)
        self.assertIn("laserLockStart();", html)
        self.assertIn("setClickToLockArmed(false)", html)

    def test_fine_scan_defaults_to_continuous(self):
        html = PANEL.read_text(encoding="utf-8")
        self.assertIn('id="scanContinuous" type="checkbox" checked', html)

    def test_lock_range_uses_halfspan_input(self):
        html = PANEL.read_text(encoding="utf-8")
        self.assertIn('id="lockRangeHalfspan"', html)
        self.assertIn("parseInputNumber('lockRangeHalfspan'", html)
        self.assertIn("setLockRangeFromBias", html)


class DefaultParameterTests(unittest.TestCase):
    def test_panel_default_values_match_validated_lab_setup(self):
        html = PANEL.read_text(encoding="utf-8")
        for fragment in [
            'id="pidIlim" value="300000"',
            'id="tecTempMin" value="20.0"',
            'id="tecTempMax" value="40.0"',
            'id="scanCh0" value="26000"',
            'id="scanStart" value="20000"',
            'id="scanStop" value="30000"',
            'id="scanDwell" value="100"',
            'id="scanSettle" value="100"',
            'id="laserCh0Max" value="40000"',
            'id="laserCh1Max" value="50000"',
            'id="adaMonitorHz" value="100000"',
            'id="adaLpShift" value="13"',
            'id="lockKp" value="0.5"',
            'id="lockKi" value="0.01"',
            'id="lockMaxStep" value="10"',
        ]:
            self.assertIn(fragment, html)

    def test_server_default_settings_match_validated_lab_setup(self):
        import butterfly_laser_server as server

        settings = server.DEFAULT_SETTINGS
        self.assertEqual(settings["tec"]["pid"]["ki"], "0.001")
        self.assertEqual(settings["tec"]["pid"]["integral_limit"], "300000")
        self.assertEqual(settings["tec"]["pid"]["dac_min"], "1800")
        self.assertEqual(settings["tec"]["pid"]["dac_max"], "2150")
        self.assertEqual(settings["tec"]["protection"]["temp_min_celsius"], "20.0")
        self.assertEqual(settings["tec"]["protection"]["temp_max_celsius"], "40.0")
        self.assertEqual(settings["laser"]["fine_scan"]["ch0"], "26000")
        self.assertEqual(settings["laser"]["fine_scan"]["start"], "20000")
        self.assertEqual(settings["laser"]["fine_scan"]["stop"], "30000")
        self.assertEqual(settings["laser"]["fine_scan"]["dwell"], "100")
        self.assertEqual(settings["laser"]["fine_scan"]["settle"], "100")
        self.assertEqual(settings["laser"]["protection"]["ch0_max"], "40000")
        self.assertEqual(settings["laser"]["protection"]["ch1_max"], "50000")
        self.assertEqual(settings["ada4355"]["monitor_rate_hz"], "100000")
        self.assertEqual(settings["ada4355"]["lp_shift"], "13")
        self.assertEqual(settings["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(settings["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(settings["laser"]["lock"]["max_step"], "10")

    def test_saved_legacy_defaults_are_migrated(self):
        import butterfly_laser_server as server

        legacy = {
            "tec": {
                "pid": {"integral_limit": "80000"},
                "protection": {"temp_min_celsius": "10.0"},
            },
            "laser": {
                "fine_scan": {
                    "ch0": "5000",
                    "start": "1000",
                    "stop": "5000",
                    "dwell": "100000",
                    "settle": "1000",
                },
                "protection": {
                    "ch0_max": "20000",
                    "ch1_max": "10000",
                },
                "lock": {
                    "kp": "0.05",
                    "ki": "0",
                    "max_step": "2",
                },
            },
            "ada4355": {
                "monitor_rate_hz": "1000",
                "lp_shift": "11",
            },
        }
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
            json.dump(legacy, tmp)
            settings_path = tmp.name

        settings = server.load_settings(settings_path)
        self.assertEqual(settings["tec"]["pid"]["ki"], "0.001")
        self.assertEqual(settings["tec"]["pid"]["integral_limit"], "300000")
        self.assertEqual(settings["tec"]["pid"]["dac_min"], "1800")
        self.assertEqual(settings["tec"]["pid"]["dac_max"], "2150")
        self.assertEqual(settings["tec"]["protection"]["temp_min_celsius"], "20.0")
        self.assertEqual(settings["laser"]["fine_scan"]["ch0"], "26000")
        self.assertEqual(settings["laser"]["fine_scan"]["start"], "20000")
        self.assertEqual(settings["laser"]["fine_scan"]["stop"], "30000")
        self.assertEqual(settings["laser"]["fine_scan"]["dwell"], "100")
        self.assertEqual(settings["laser"]["fine_scan"]["settle"], "100")
        self.assertEqual(settings["laser"]["protection"]["ch0_max"], "40000")
        self.assertEqual(settings["laser"]["protection"]["ch1_max"], "50000")
        self.assertEqual(settings["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(settings["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(settings["laser"]["lock"]["max_step"], "10")
        self.assertEqual(settings["ada4355"]["monitor_rate_hz"], "100000")
        self.assertEqual(settings["ada4355"]["lp_shift"], "13")

    def test_saved_schema_v2_with_legacy_defaults_is_migrated(self):
        import butterfly_laser_server as server

        legacy = {
            "settings_schema_version": 2,
            "tec": {"pid": {"integral_limit": "80000"}},
            "laser": {"lock": {"kp": "0.05", "ki": "0", "max_step": "2"}},
        }
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
            json.dump(legacy, tmp)
            settings_path = tmp.name

        settings = server.load_settings(settings_path)
        self.assertEqual(settings["tec"]["pid"]["integral_limit"], "300000")
        self.assertEqual(settings["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(settings["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(settings["laser"]["lock"]["max_step"], "10")

    def test_cli_defaults_match_validated_lab_setup(self):
        import butterfly_laser_control as control

        parser = control.build_parser()
        args = parser.parse_args(
            [
                "laser-fine-scan",
                "--ch0",
                "26000",
                "--start",
                "20000",
                "--stop",
                "30000",
                "--step",
                "10",
            ]
        )
        self.assertEqual(args.dwell, 100)
        self.assertEqual(args.settle, 100)
        self.assertEqual(args.ch0_max, 40000)
        self.assertEqual(args.ch1_max, 50000)

        lock_args = parser.parse_args(
            [
                "laser-lock",
                "--ch0",
                "26000",
                "--target-adc",
                "42000",
                "--bias-ch1",
                "25000",
                "--lock-ch1-min",
                "24000",
                "--lock-ch1-max",
                "26000",
            ]
        )
        self.assertEqual(lock_args.kp, 0.5)
        self.assertEqual(lock_args.ki, 0.01)
        self.assertEqual(lock_args.max_step, 10)

    def test_ada_rtl_defaults_support_100khz_lock_feedback(self):
        rtl = ADA_AXI.read_text(encoding="utf-8")
        self.assertIn("monitor_decim_n_reg <= 32'd1250;", rtl)
        self.assertIn("lp_shift_reg <= 32'd13;", rtl)

    def test_laser_rtl_lock_defaults_match_panel_defaults(self):
        rtl = LASER_AXI.read_text(encoding="utf-8")
        self.assertIn("slv_reg[31] <= 32'd32768;", rtl)
        self.assertIn("slv_reg[37] <= 32'd655;", rtl)
        self.assertIn("slv_reg[39] <= 32'd10;", rtl)

    def test_laser_rtl_exposes_versioned_board_acquire_registers(self):
        rtl = LASER_AXI.read_text(encoding="utf-8")
        self.assertIn("C_S_AXI_ADDR_WIDTH = 8", rtl)
        self.assertIn("OPT_MEM_ADDR_BITS = 5", rtl)
        self.assertNotIn("axi_awaddr[ADDR_LSB+OPT_MEM_ADDR_BITS : ADDR_LSB]", rtl)
        self.assertIn("LASER_CURRENT_CTRL_VERSION = 32'h0002_0000", rtl)
        self.assertIn("REG_ACQUIRE_CONTROL      = 6'd50", rtl)
        self.assertIn("acquire_arm_pulse", rtl)


class LegacyBackupTests(unittest.TestCase):
    def test_legacy_gui_backup_files_exist(self):
        backup = ROOT / "legacy_web_gui_2026-06-20"
        self.assertTrue((backup / "butterfly_laser_server.py").exists())
        self.assertTrue((backup / "butterfly_laser_control.py").exists())
        self.assertTrue((backup / "butterfly_laser_panel.html").exists())


if __name__ == "__main__":
    unittest.main()

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
TEC_AXI = Path(
    "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/"
    "ad4170_tec_ctrl_1_0/hdl/ad4170_tec_ctrl_v1_0_S00_AXI.v"
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
            'id="pidKp" value="1"',
            'id="pidKi" value="0.003"',
            'id="pidIlim" value="300000"',
            'id="tecTempMin" value="20.0"',
            'id="tecTempMax" value="40.0"',
            'id="scanCh0" value="26000"',
            'id="scanStart" value="20000"',
            'id="scanStop" value="30000"',
            'id="scanDwell" value="100"',
            'id="scanSettle" value="100"',
            'id="laserCh0Max" value="40000"',
            'id="laserCh1Max" value="40000"',
            'id="adaMonitorHz" value="100000"',
            'id="adaLpShift" value="13"',
            'id="lockKp" value="0.5"',
            'id="lockKi" value="0.01"',
            'id="lockRangeHalfspan" value="5000"',
            'id="lockMaxStep" value="3"',
            'id="lockLockedThreshold" value="1000"',
            'id="lockLossThreshold" value="10000"',
        ]:
            self.assertIn(fragment, html)

    def test_server_default_settings_match_validated_lab_setup(self):
        import butterfly_laser_server as server

        settings = server.DEFAULT_SETTINGS
        self.assertEqual(settings["tec"]["pid"]["kp"], "1")
        self.assertEqual(settings["tec"]["pid"]["ki"], "0.003")
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
        self.assertEqual(settings["laser"]["protection"]["ch1_max"], "40000")
        self.assertEqual(settings["ada4355"]["monitor_rate_hz"], "100000")
        self.assertEqual(settings["ada4355"]["lp_shift"], "13")
        self.assertEqual(settings["ada4355"]["raw_lp_shift"], "13")
        self.assertEqual(settings["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(settings["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(settings["laser"]["lock"]["range_halfspan"], "5000")
        self.assertEqual(settings["laser"]["lock"]["max_step"], "3")
        self.assertEqual(settings["laser"]["lock"]["integral_limit"], "500000")
        self.assertEqual(settings["laser"]["lock"]["locked_threshold"], "1000")
        self.assertEqual(settings["laser"]["lock"]["loss_threshold"], "10000")

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
        self.assertEqual(settings["tec"]["pid"]["kp"], "1")
        self.assertEqual(settings["tec"]["pid"]["ki"], "0.003")
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
        self.assertEqual(settings["laser"]["protection"]["ch1_max"], "40000")
        self.assertEqual(settings["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(settings["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(settings["laser"]["lock"]["max_step"], "3")
        self.assertEqual(settings["laser"]["lock"]["integral_limit"], "500000")
        self.assertEqual(settings["laser"]["lock"]["locked_threshold"], "1000")
        self.assertEqual(settings["laser"]["lock"]["loss_threshold"], "10000")
        self.assertEqual(settings["ada4355"]["monitor_rate_hz"], "100000")
        self.assertEqual(settings["ada4355"]["lp_shift"], "13")
        self.assertEqual(settings["ada4355"]["raw_lp_shift"], "13")

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
        self.assertEqual(settings["laser"]["lock"]["max_step"], "3")
        self.assertEqual(settings["laser"]["lock"]["integral_limit"], "500000")
        self.assertEqual(settings["laser"]["lock"]["locked_threshold"], "1000")
        self.assertEqual(settings["laser"]["lock"]["loss_threshold"], "10000")

    def test_missing_settings_file_is_created_with_defaults(self):
        import butterfly_laser_server as server

        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "butterfly_laser_settings.json"

            settings = server.load_settings(settings_path)

            self.assertTrue(settings_path.exists())
            saved = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["settings_schema_version"], server.SETTINGS_SCHEMA_VERSION)
            self.assertEqual(settings["tec"]["pid"]["kp"], "1")
            self.assertEqual(saved["laser"]["lock"]["integral_limit"], "500000")

    def test_startup_parameter_initialization_applies_settings_without_enabling_outputs(self):
        import butterfly_laser_server as server

        class FakeTec:
            def __init__(self):
                self.started = False
                self.target = None
                self.pid = None
                self.writes = []

            def set_target_celsius(self, value):
                self.target = value

            def configure_pid(self, **kwargs):
                self.pid = kwargs

            def write(self, name, value):
                self.writes.append((name, value))

            def start_closed_loop(self):
                self.started = True

            def status(self):
                return {"status_flags": []}

        class FakeLaser:
            def __init__(self):
                self.started = False
                self.safety = None
                self.lock = None
                self.writes = []

            def configure_safety(self, **kwargs):
                self.safety = kwargs

            def write(self, name, value):
                self.writes.append((name, value))

            def configure_lock(self, **kwargs):
                self.lock = kwargs

            def start_static(self, *args, **kwargs):
                self.started = True

            def start_fine_scan(self, *args, **kwargs):
                self.started = True

        class FakeAda:
            def __init__(self):
                self.monitor_rate = None
                self.capture = None
                self.filter = None

            def set_monitor_rate_hz(self, value):
                self.monitor_rate = value

            def configure_capture(self, **kwargs):
                self.capture = kwargs

            def configure_filter(self, **kwargs):
                self.filter = kwargs

        class FakeSystem:
            def __init__(self):
                self.tec = FakeTec()
                self.laser = FakeLaser()
                self.ada = FakeAda()

        system = FakeSystem()

        server.initialize_pl_parameters(system, server.DEFAULT_SETTINGS)

        self.assertEqual(system.tec.target, 31.0)
        self.assertEqual(system.tec.pid["integral_limit"], 300000)
        self.assertEqual(system.laser.safety["ch0_max"], 40000)
        self.assertEqual(system.laser.lock["integral_limit"], 500000)
        self.assertEqual(system.ada.monitor_rate, 100000.0)
        self.assertEqual(system.ada.capture["max_points"], 16384)
        self.assertEqual(system.ada.capture["frame_decim"], 1000)
        self.assertEqual(system.ada.filter["lp_shift"], 13)
        self.assertEqual(system.ada.filter["raw_lp_shift"], 13)
        self.assertFalse(system.tec.started)
        self.assertFalse(system.laser.started)

    def test_laser_output_requires_tec_enabled(self):
        import butterfly_laser_server as server

        self.assertFalse(server.is_tec_enabled_for_laser({"status_flags": []}))
        self.assertFalse(server.is_tec_enabled_for_laser({"status_flags": ["closed_loop"]}))
        self.assertTrue(server.is_tec_enabled_for_laser({"status_flags": ["tec_enabled"]}))

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
        self.assertEqual(args.ch1_max, 40000)

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
        self.assertEqual(lock_args.max_step, 3)
        self.assertEqual(lock_args.integral_limit, 500000)
        self.assertEqual(lock_args.locked_threshold, 1000)
        self.assertEqual(lock_args.loss_threshold, 10000)

    def test_ada_rtl_defaults_support_100khz_lock_feedback(self):
        rtl = ADA_AXI.read_text(encoding="utf-8")
        self.assertIn("monitor_decim_n_reg <= 32'd1250;", rtl)
        self.assertIn("lp_shift_reg <= 32'd13;", rtl)

    def test_laser_rtl_lock_defaults_match_panel_defaults(self):
        rtl = LASER_AXI.read_text(encoding="utf-8")
        self.assertIn("slv_reg[16] <= 32'h0000_0000;", rtl)
        self.assertIn("slv_reg[17] <= 32'h0000_0000;", rtl)
        self.assertIn("slv_reg[29] <= 32'd0;", rtl)
        self.assertIn("slv_reg[30] <= 32'd0;", rtl)
        self.assertIn("slv_reg[31] <= 32'd32768;", rtl)
        self.assertIn("slv_reg[37] <= 32'd655;", rtl)
        self.assertIn("slv_reg[38] <= 32'd100000;", rtl)
        self.assertIn("slv_reg[39] <= 32'd10;", rtl)
        self.assertIn("slv_reg[40] <= 32'h03E8_0032;", rtl)

    def test_tec_rtl_defaults_match_panel_defaults(self):
        rtl = TEC_AXI.read_text(encoding="utf-8")
        self.assertIn("temp_min_limit <= 32'sd10000;", rtl)
        self.assertIn("pid_kp <= 32'sh0000_cccd;", rtl)
        self.assertIn("pid_ki <= 32'sh0004_1893;", rtl)
        self.assertIn("pid_integral_limit <= 32'sd80000;", rtl)

    def test_laser_rtl_exposes_versioned_board_acquire_registers(self):
        rtl = LASER_AXI.read_text(encoding="utf-8")
        self.assertIn("C_S_AXI_ADDR_WIDTH = 8", rtl)
        self.assertIn("OPT_MEM_ADDR_BITS = 5", rtl)
        self.assertNotIn("axi_awaddr[ADDR_LSB+OPT_MEM_ADDR_BITS : ADDR_LSB]", rtl)
        self.assertIn("LASER_CURRENT_CTRL_VERSION = 32'h0002_0000", rtl)
        self.assertIn("REG_ACQUIRE_CONTROL      = 6'd50", rtl)
        self.assertIn("acquire_arm_pulse", rtl)

    def test_laser_rtl_board_acquire_requires_same_polarity_crossing(self):
        rtl = (LASER_AXI.parent / "laser_current_ctrl_core.v").read_text(encoding="utf-8")
        self.assertIn("acquire_same_polarity_w", rtl)
        self.assertIn("acquire_same_polarity_w && acquire_cross_w", rtl)
        self.assertNotIn("(acquire_cross_w || acquire_threshold_hit_w)", rtl)

    def test_tauri_lock_panel_exposes_lock_method(self):
        panel = (ROOT / "tauri_control_console/src/components/LockPanel.tsx").read_text(encoding="utf-8")
        self.assertIn("Lock Method", panel)
        self.assertIn("Direct Lock", panel)
        self.assertIn("Board Match Lock", panel)
        self.assertIn("lockMethod === \"direct\"", panel)
        self.assertIn("lockMethod === \"board\"", panel)

    def test_tauri_lock_panel_separates_lock_range_from_board_search_range(self):
        panel = (ROOT / "tauri_control_console/src/components/LockPanel.tsx").read_text(encoding="utf-8")
        self.assertIn("Board Search Halfspan", panel)
        self.assertIn("const searchHalfspan", panel)
        self.assertIn("searchHalfspanCode: numberFromInput(searchHalfspan.value)", panel)
        self.assertIn('Field label="CH1 Range Halfspan"', panel)

    def test_tauri_defaults_match_current_lab_setup(self):
        tec = (ROOT / "tauri_control_console/src/components/TecPanel.tsx").read_text(encoding="utf-8")
        laser = (ROOT / "tauri_control_console/src/components/LaserPanel.tsx").read_text(encoding="utf-8")
        lock = (ROOT / "tauri_control_console/src/components/LockPanel.tsx").read_text(encoding="utf-8")
        self.assertIn('useSyncedInput(inputNumber(tec?.pid?.kp, 6), "1")', tec)
        self.assertIn('useSyncedInput(inputNumber(tec?.pid?.ki, 8), "0.003")', tec)
        self.assertIn('useSyncedInput(inputInt(laser?.safety?.ch1_max), "40000")', laser)
        self.assertIn('useSyncedInput(inputInt(lockHalfspan), "5000")', lock)
        self.assertIn('useSyncedInput(inputInt(acquireSearchHalfspan), "1000")', lock)
        self.assertIn('useSyncedInput(inputInt(lock?.max_step), "3")', lock)
        self.assertIn('useSyncedInput(inputInt(lock?.integral_limit), "500000")', lock)
        self.assertIn('useSyncedInput(inputInt(lock?.locked_threshold), "1000")', lock)
        self.assertIn('useSyncedInput(inputInt(lock?.loss_threshold), "10000")', lock)

    def test_tauri_laser_panel_exposes_only_ch1_max_safety_limit(self):
        panel = (ROOT / "tauri_control_console/src/components/LaserPanel.tsx").read_text(encoding="utf-8")
        self.assertNotIn("const ch1Min", panel)
        self.assertIn("ch1_min: 0", panel)
        self.assertNotIn('Field label="CH1 Min"', panel)
        self.assertIn('Field label="CH1 Max"', panel)

    def test_tauri_laser_controls_are_locked_when_tec_is_off(self):
        panel = (ROOT / "tauri_control_console/src/components/LaserPanel.tsx").read_text(encoding="utf-8")
        self.assertIn("isTecRunning", panel)
        self.assertIn("laserBlockedByTec", panel)
        self.assertIn("TEC must be On before laser output can be enabled.", panel)

    def test_tauri_lock_controls_are_locked_when_tec_is_off(self):
        panel = (ROOT / "tauri_control_console/src/components/LockPanel.tsx").read_text(encoding="utf-8")
        self.assertIn("isTecRunning", panel)
        self.assertIn("lockBlockedByTec", panel)
        self.assertIn("TEC must be On before side-fringe locking.", panel)

    def test_tauri_lock_panel_has_only_update_parameters_action(self):
        panel = (ROOT / "tauri_control_console/src/components/LockPanel.tsx").read_text(encoding="utf-8")
        self.assertIn("Update Parameters", panel)
        self.assertNotIn(">Start Lock<", panel)
        self.assertNotIn(">Hold Current<", panel)
        self.assertNotIn(">Clear Lock Fault<", panel)
        self.assertNotIn(">Cancel Acquire<", panel)

    def test_server_does_not_replace_lock_range_with_acquire_search_range(self):
        server = (ROOT / "butterfly_laser_server.py").read_text(encoding="utf-8")
        self.assertNotIn('lock_params["ch1_min"] = acquire["search_min"]', server)
        self.assertNotIn('lock_params["ch1_max"] = acquire["search_max"]', server)


class LegacyBackupTests(unittest.TestCase):
    def test_legacy_gui_backup_files_exist(self):
        backup = ROOT / "legacy_web_gui_2026-06-20"
        self.assertTrue((backup / "butterfly_laser_server.py").exists())
        self.assertTrue((backup / "butterfly_laser_control.py").exists())
        self.assertTrue((backup / "butterfly_laser_panel.html").exists())


if __name__ == "__main__":
    unittest.main()

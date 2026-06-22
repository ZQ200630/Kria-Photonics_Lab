import unittest

from butterfly_laser_server import TecTargetRamp, server_status


class FakeTec:
    def __init__(self, target_celsius=31.0):
        self.target_celsius = target_celsius
        self.writes = []

    def set_target_celsius(self, celsius):
        self.target_celsius = float(celsius)
        self.writes.append(float(celsius))

    def status(self):
        return {
            "target_celsius": self.target_celsius,
            "temperature_filtered_celsius": self.target_celsius,
        }


class FakeSystem:
    def __init__(self, tec):
        self.tec = tec

    def status(self):
        return {"tec": self.tec.status(), "laser": {}, "ada4355": {}}


class FakeServer:
    def __init__(self, system, ramp):
        self.system = system
        self.tec_ramp = ramp


class TecTargetRampTests(unittest.TestCase):
    def test_ramp_step_limits_target_change(self):
        tec = FakeTec(target_celsius=31.0)
        ramp = TecTargetRamp(tec, enabled=True, rate_c_per_s=0.5, interval_ms=200)

        ramp.start(32.0, run_async=False)
        done = ramp.step_once()

        self.assertFalse(done)
        self.assertEqual(tec.writes, [31.1])
        self.assertTrue(ramp.status()["active"])

    def test_ramp_finishes_without_overshooting(self):
        tec = FakeTec(target_celsius=31.95)
        ramp = TecTargetRamp(tec, enabled=True, rate_c_per_s=0.5, interval_ms=200)

        ramp.start(32.0, run_async=False)
        done = ramp.step_once()

        self.assertTrue(done)
        self.assertEqual(tec.writes, [32.0])
        self.assertFalse(ramp.status()["active"])

    def test_server_status_includes_ramp_status(self):
        tec = FakeTec(target_celsius=31.0)
        ramp = TecTargetRamp(tec, enabled=True, rate_c_per_s=0.05, interval_ms=200)
        ramp.start(32.0, run_async=False)

        status = server_status(FakeServer(FakeSystem(tec), ramp))

        self.assertEqual(status["tec"]["ramp"]["target_celsius"], 32.0)
        self.assertEqual(status["tec"]["ramp"]["rate_c_per_s"], 0.05)


if __name__ == "__main__":
    unittest.main()

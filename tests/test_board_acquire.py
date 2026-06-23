import unittest

import butterfly_laser_control as control


class FakeRegs:
    def __init__(self, initial=None):
        self.values = dict(initial or {})
        self.writes = []

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))


class BoardAcquireControlTests(unittest.TestCase):
    def test_acquire_support_requires_version_2_bitstream(self):
        old_laser = control.LaserCurrentController(FakeRegs({control.LASER_REG.get("VERSION", 0xFC): 0}))
        new_laser = control.LaserCurrentController(FakeRegs({control.LASER_REG.get("VERSION", 0xFC): 0x00020000}))

        self.assertFalse(old_laser.supports_board_acquire())
        self.assertTrue(new_laser.supports_board_acquire())

    def test_configure_acquire_writes_versioned_acquire_registers(self):
        regs = FakeRegs({control.LASER_REG.get("VERSION", 0xFC): 0x00020000})
        laser = control.LaserCurrentController(regs)

        laser.configure_acquire(search_min=24000, search_max=26000, threshold=25)

        self.assertEqual(control.LASER_REG["ACQUIRE_CONTROL"], 0xC8)
        self.assertEqual(control.LASER_REG["ACQUIRE_MATCH_ERROR"], 0xE0)
        self.assertIn((control.LASER_REG["ACQUIRE_SEARCH_RANGE"], (26000 << 16) | 24000), regs.writes)
        self.assertIn((control.LASER_REG["ACQUIRE_THRESHOLD"], 25), regs.writes)
        self.assertIn((control.LASER_REG["ACQUIRE_CONTROL"], control.LASER_ACQ_ENABLE), regs.writes)

    def test_arm_acquire_refuses_old_bitstreams(self):
        laser = control.LaserCurrentController(FakeRegs({control.LASER_REG.get("VERSION", 0xFC): 0}))

        with self.assertRaisesRegex(RuntimeError, "does not support board acquire"):
            laser.arm_acquire()


if __name__ == "__main__":
    unittest.main()

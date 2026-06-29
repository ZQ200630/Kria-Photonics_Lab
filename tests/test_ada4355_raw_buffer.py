import unittest

import butterfly_laser_control as control
import butterfly_laser_server as server
import butterfly_laser_server_tauri as tauri_server


class FakeRegs:
    def __init__(self, base=0xA0100000, words=None):
        self.base = base
        self.values = {}
        self.writes = []
        self.words = list(words or [])
        self.last_read_count = None
        self.closed = False

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))

    def read_words(self, count):
        self.last_read_count = count
        return self.words[:count]

    def close(self):
        self.closed = True


class Ada4355RawBufferTests(unittest.TestCase):
    def test_axi_map_closes_fd_when_mmap_fails(self):
        closed = []

        def fake_open(_dev, _flags):
            return 123

        def fake_mmap(*_args, **_kwargs):
            raise OSError("mmap failed")

        def fake_close(fd):
            closed.append(fd)

        original_open = control.os.open
        original_close = control.os.close
        original_mmap = control.mmap.mmap
        control.os.open = fake_open
        control.os.close = fake_close
        control.mmap.mmap = fake_mmap
        try:
            with self.assertRaisesRegex(OSError, "mmap failed"):
                control.AxiMap(0xA0000000, 0x1000)
            self.assertEqual(closed, [123])
        finally:
            control.os.open = original_open
            control.os.close = original_close
            control.mmap.mmap = original_mmap

    def make_capture(self, raw_words):
        regs = FakeRegs()
        regs.values[control.ADA_REG["RAW_STATUS"]] = 0x4
        regs.values[control.ADA_REG["RAW_WRITE_COUNT"]] = 5
        regs.values[control.ADA_REG["RAW_DECIM"]] = 2
        raw = FakeRegs(base=control.DEFAULT_ADA_RAW_BASE, words=raw_words)
        ada = control.Ada4355Capture(regs, FakeRegs(base=0xA01C0000), FakeRegs(base=0xA01D0000), raw)
        return ada, regs, raw

    def test_raw_constants_describe_packed_512k_buffer(self):
        self.assertEqual(control.DEFAULT_ADA_RAW_BASE, 0xA0200000)
        self.assertEqual(control.DEFAULT_RAW_BUFFER_SPAN, 0x00100000)
        self.assertEqual(control.ADA_RAW_MAX_POINTS, 524288)
        self.assertEqual(control.ADA_RAW_BUFFER_WORDS, 262144)
        self.assertEqual(control.ADA_REG["RAW_LP_SHIFT"], 0x9C)
        self.assertEqual(control.ADA_REG["RAW_FILTERED_ADC_LAST"], 0xA0)
        self.assertEqual(control.ADA_REG["RAW_CAPACITY_SAMPLES"], 0xA4)
        self.assertEqual(control.ADA_REG["RAW_BUFFER_WORDS"], 0xA8)
        self.assertEqual(control.ADA_REG["RAW_DEBUG"], 0xAC)
        self.assertEqual(control.ADA_REG["RAW_WRITER_WORDS"], 0xB0)
        self.assertEqual(control.ADA_REG["RAW_MEM_WRITES"], 0xB4)
        self.assertEqual(control.ADA_REG["RAW_LAST_FIFO"], 0xB8)
        self.assertEqual(control.ADA_REG["RAW_LAST_MEM_LO"], 0xBC)
        self.assertEqual(control.ADA_REG["RAW_LAST_MEM_HI"], 0xC0)
        self.assertEqual(control.ADA_REG["RAW_READ_LO"], 0xC4)
        self.assertEqual(control.ADA_REG["RAW_READ_HI"], 0xC8)
        self.assertEqual(control.ADA_REG["RAW_READ_ADDR"], 0xCC)
        self.assertEqual(control.ADA_FILTER_RAW_GLITCH_REJECT, 0x20)

    def test_read_raw_unpacks_two_u16_samples_per_word(self):
        ada, _regs, raw = self.make_capture([0x22221111, 0x44443333, 0x00005555])

        result = ada.read_raw()

        self.assertEqual(raw.last_read_count, 3)
        self.assertEqual(result["count"], 5)
        self.assertEqual(result["samples"], [0x1111, 0x2222, 0x3333, 0x4444, 0x5555])
        self.assertEqual(result["storage"], "packed_u16_le")
        self.assertEqual(result["raw_write_count"], 5)
        self.assertEqual(result["decim"], 2)

    def test_capture_raw_accepts_512k_samples(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["RAW_WRITE_COUNT"]] = control.ADA_RAW_MAX_POINTS

        meta = ada.capture_raw(length=control.ADA_RAW_MAX_POINTS, decim=4, timeout=0)

        self.assertEqual(meta["length"], control.ADA_RAW_MAX_POINTS)
        self.assertEqual(meta["write_count"], control.ADA_RAW_MAX_POINTS)
        self.assertIn((control.ADA_REG["RAW_LENGTH"], control.ADA_RAW_MAX_POINTS), regs.writes)
        self.assertIn((control.ADA_REG["RAW_DECIM"], 4), regs.writes)

    def test_configure_filter_writes_raw_lp_shift_independently(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["FILTER_CONTROL"]] = control.ADA_FILTER_DEFAULT

        ada.configure_filter(lp_shift=7, raw_lp_shift=12)

        self.assertIn((control.ADA_REG["LP_SHIFT"], 7), regs.writes)
        self.assertIn((control.ADA_REG["RAW_LP_SHIFT"], 12), regs.writes)

        raw_only, raw_only_regs, _raw = self.make_capture([])
        raw_only_regs.values[control.ADA_REG["FILTER_CONTROL"]] = control.ADA_FILTER_DEFAULT

        raw_only.configure_filter(raw_lp_shift=12)

        self.assertIn((control.ADA_REG["RAW_LP_SHIFT"], 12), raw_only_regs.writes)
        self.assertFalse(
            any(
                offset == control.ADA_REG["LP_SHIFT"]
                for offset, _value in raw_only_regs.writes
            )
        )

    def test_configure_filter_updates_raw_glitch_bit_independently(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["FILTER_CONTROL"]] = control.ADA_FILTER_DEFAULT

        ada.configure_filter(raw_glitch_reject=True)

        self.assertIn(
            (
                control.ADA_REG["FILTER_CONTROL"],
                control.ADA_FILTER_DEFAULT | control.ADA_FILTER_RAW_GLITCH_REJECT,
            ),
            regs.writes,
        )

        ada.configure_filter(raw_glitch_reject=False)

        self.assertEqual(regs.writes[-1], (control.ADA_REG["FILTER_CONTROL"], control.ADA_FILTER_DEFAULT))

    def test_status_exposes_raw_glitch_readback(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["FILTER_CONTROL"]] = control.ADA_FILTER_RAW_GLITCH_REJECT

        status = ada.status()

        self.assertTrue(status["filter"]["raw_glitch_reject"])

    def test_system_constructor_maps_raw_buffer_and_closes_it(self):
        class FakeAxiMap(FakeRegs):
            def __init__(self, base, span, dev="/dev/mem"):
                super().__init__(base=control.parse_int(base))
                self.span = control.parse_int(span)

        original = control.AxiMap
        control.AxiMap = FakeAxiMap
        try:
            system = control.ButterflyLaserSystem(
                ada_raw_base=control.DEFAULT_ADA_RAW_BASE,
                raw_buffer_span=control.DEFAULT_RAW_BUFFER_SPAN,
            )
            self.assertEqual(system.ada.raw_buf_regs.base, control.DEFAULT_ADA_RAW_BASE)
            self.assertEqual(system.ada.raw_buf_regs.span, control.DEFAULT_RAW_BUFFER_SPAN)
            system.close()
            self.assertTrue(system.ada_raw_regs.closed)
        finally:
            control.AxiMap = original


class Ada4355ServerRawBufferTests(unittest.TestCase):
    def test_server_defaults_include_raw_lp_shift(self):
        self.assertEqual(server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")

    def test_parsers_expose_raw_buffer_addresses(self):
        parser = server.build_parser()
        args = parser.parse_args([])
        self.assertEqual(control.parse_int(args.ada_raw_base), control.DEFAULT_ADA_RAW_BASE)
        self.assertEqual(control.parse_int(args.raw_buffer_span), control.DEFAULT_RAW_BUFFER_SPAN)


if __name__ == "__main__":
    unittest.main()

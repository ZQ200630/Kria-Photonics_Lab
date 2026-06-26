import json
import struct
import unittest

import pa_imaging_capture as pa


class FakeRegs:
    def __init__(self):
        self.values = {}
        self.writes = []

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))


class PaProtocolTests(unittest.TestCase):
    def test_pam_params_pack_signed_16_bit_values_like_axis_capture_app(self):
        params = pa.PamCaptureParams(x_start=-1000, x_step=25, x_points=128)

        packed = params.register_values()

        self.assertEqual(packed[pa.PAM_REG_X_START], 0xFC18)
        self.assertEqual(packed[pa.PAM_REG_X_STEP], 25)
        self.assertEqual(packed[pa.PAM_REG_X_POINTS], 128)
        self.assertEqual(packed[pa.PAM_REG_SCAN_MODE], 0)

    def test_pam_params_reject_invalid_count_register_values(self):
        invalid_params = (
            pa.PamCaptureParams(x_points=0),
            pa.PamCaptureParams(x_points=-1),
            pa.PamCaptureParams(y_points=0),
            pa.PamCaptureParams(frame_number=0),
        )

        for params in invalid_params:
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    params.register_values()

    def test_pam_axi_program_forces_start_low_before_register_writes(self):
        regs = FakeRegs()
        params = pa.PamCaptureParams(x_start=-1, x_step=2, x_points=3)
        controller = pa.PamAxiController(regs)

        controller.program(params, verify=True)

        self.assertEqual(regs.writes[0], (pa.PAM_REG_START, 0))
        self.assertIn((pa.PAM_REG_X_START, 0xFFFF), regs.writes)
        self.assertIn((pa.PAM_REG_X_STEP, 2), regs.writes)
        self.assertIn((pa.PAM_REG_X_POINTS, 3), regs.writes)

    def test_stream_record_header_is_little_endian_and_self_describing(self):
        record = pa.PaStreamRecord(
            record_type=pa.RECORD_TYPE_DATA,
            sequence=7,
            timestamp_ns=123,
            block_id=9,
            frame_count=4,
            first_frame_id=11,
            last_frame_id=14,
            payload=b"abcd",
        )

        encoded = record.encode()
        header = struct.unpack(pa.STREAM_RECORD_HEADER_FORMAT, encoded[:pa.STREAM_RECORD_HEADER_BYTES])

        self.assertEqual(header[0], pa.STREAM_MAGIC)
        self.assertEqual(header[1], pa.STREAM_VERSION)
        self.assertEqual(header[2], pa.RECORD_TYPE_DATA)
        self.assertEqual(header[3], pa.STREAM_RECORD_HEADER_BYTES)
        self.assertEqual(header[4], 4)
        self.assertEqual(header[5], 7)
        self.assertEqual(header[7], 9)
        self.assertEqual(encoded[pa.STREAM_RECORD_HEADER_BYTES:], b"abcd")

    def test_metadata_record_encodes_compact_json_payload(self):
        record = pa.metadata_record(sequence=1, timestamp_ns=2, payload={"x_points": 3})

        decoded = json.loads(record.payload.decode("utf-8"))

        self.assertEqual(record.record_type, pa.RECORD_TYPE_METADATA)
        self.assertEqual(decoded, {"x_points": 3})

    def test_axis_status_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<15I", 1, 1, 0, 4096, 33554432, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1)

        status = pa.AxisCaptureStatus.unpack(raw)

        self.assertTrue(status.running)
        self.assertTrue(status.stop_requested)
        self.assertFalse(status.removing)
        self.assertEqual(status.frame_bytes, 4096)
        self.assertEqual(status.superblock_bytes, 33554432)
        self.assertEqual(status.active_dma_count, 2)
        self.assertEqual(status.done_count, 3)
        self.assertEqual(status.ready_block_count, 4)
        self.assertEqual(status.free_block_count, 5)
        self.assertEqual(status.completed_frames, 6)
        self.assertEqual(status.aggregated_frames, 7)
        self.assertEqual(status.completed_blocks, 8)
        self.assertEqual(status.dropped_frames, 9)
        self.assertEqual(status.dropped_blocks, 10)
        self.assertTrue(status.draining_done)

    def test_axis_block_header_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<QIIQQ", 5, 12, 3, 20, 22)

        header = pa.AxisBlockHeader.unpack(raw)

        self.assertEqual(header.block_id, 5)
        self.assertEqual(header.used_bytes, 12)
        self.assertEqual(header.frame_count, 3)
        self.assertEqual(header.first_frame_id, 20)
        self.assertEqual(header.last_frame_id, 22)


if __name__ == "__main__":
    unittest.main()

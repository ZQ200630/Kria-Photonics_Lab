import json
import unittest

import butterfly_laser_server_tauri as server


class SseHelperTests(unittest.TestCase):
    def test_sse_event_encodes_event_name_and_json_payload(self):
        payload = {"ok": True, "value": 3}
        encoded = server.format_sse("status", payload)
        self.assertTrue(encoded.endswith("\n\n"))
        self.assertIn("event: status\n", encoded)
        data_line = next(line for line in encoded.splitlines() if line.startswith("data: "))
        self.assertEqual(json.loads(data_line[6:]), payload)

    def test_spectrum_key_uses_frame_buffer_and_count(self):
        first = {"frame_counter": 12, "buffer_id": 0, "count": 16384}
        same = {"frame_counter": 12, "buffer_id": 0, "count": 16384}
        next_frame = {"frame_counter": 13, "buffer_id": 0, "count": 16384}
        self.assertEqual(server.spectrum_key(first), server.spectrum_key(same))
        self.assertNotEqual(server.spectrum_key(first), server.spectrum_key(next_frame))

    def test_fault_signature_changes_on_laser_fault(self):
        clean = {
            "tec": {"status_hex": "0x00000000", "main_error_status_hex": "0x00000000"},
            "laser": {"status_hex": "0x00000000", "fault_status_hex": "0x00000000"},
            "ada4355": {"status_hex": "0x00000000"},
        }
        faulted = {
            "tec": {"status_hex": "0x00000000", "main_error_status_hex": "0x00000000"},
            "laser": {"status_hex": "0x00000000", "fault_status_hex": "0x00000004"},
            "ada4355": {"status_hex": "0x00000000"},
        }
        self.assertNotEqual(server.fault_signature(clean), server.fault_signature(faulted))


if __name__ == "__main__":
    unittest.main()

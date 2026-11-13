"""Read-model regression: preserve parent identity when span times overlap."""
import unittest
from unittest.mock import patch
from server import runs


class ArchitectureTraceTests(unittest.TestCase):
    def test_timeline_preserves_actual_parents_and_missing_time(self):
        spans = [
            {"id": "root", "parent_id": None, "started_at": "2026-01-01T00:00:00Z", "ended_at": None,
             "span_data": {"type": "agent", "name": "Example"}},
            {"id": "a", "parent_id": "root", "started_at": "2026-01-01T00:00:01Z", "ended_at": "2026-01-01T00:00:10Z",
             "span_data": {"type": "function", "name": "first"}},
            {"id": "b", "parent_id": "root", "started_at": "2026-01-01T00:00:02Z", "ended_at": "2026-01-01T00:00:09Z",
             "span_data": {"type": "function", "name": "second"}},
            {"id": "aa", "parent_id": "a", "started_at": "2026-01-01T00:00:03Z", "ended_at": "2026-01-01T00:00:08Z",
             "span_data": {"type": "function", "name": "child"}},
        ]
        with patch.object(runs, "read_run", return_value=None), patch.object(runs, "read_spans", return_value=spans):
            detail = runs.run_detail("trace_example")
        timeline = {span["id"]: span for span in detail["timeline"]}
        self.assertIsNone(timeline["root"]["parent_id"])
        self.assertIsNone(timeline["root"]["duration_ms"])
        self.assertEqual(timeline["aa"]["parent_id"], "a")
        self.assertEqual(timeline["aa"]["offset_ms"], 3000)
        self.assertEqual(timeline["aa"]["duration_ms"], 5000)
        self.assertEqual(timeline["aa"]["depth"], 2)


if __name__ == "__main__":
    unittest.main()

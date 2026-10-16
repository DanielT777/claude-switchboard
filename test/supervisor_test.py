import importlib.util
from pathlib import Path
import time
import unittest

spec = importlib.util.spec_from_file_location('supervisor', Path(__file__).parents[1] / 'src/supervisor.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class StopGuard(unittest.TestCase):
    def test_requires_same_idle_session_and_no_input_since_hook(self):
        record = {'sessionId': 'test', 'state': 'idle', 'at': time.time() * 1000 - 2000}
        self.assertTrue(supervisor.stop_allowed(record, 'test', 0))
        self.assertFalse(supervisor.stop_allowed(record, 'other', 0))
        self.assertFalse(supervisor.stop_allowed(record, 'test', record['at'] + 1))
        for state in ('working', 'permission', 'unknown', 'ended'):
            self.assertFalse(supervisor.stop_allowed({**record, 'state': state}, 'test', 0))
        self.assertFalse(supervisor.stop_allowed({**record, 'at': time.time() * 1000}, 'test', 0))


if __name__ == '__main__':
    unittest.main()

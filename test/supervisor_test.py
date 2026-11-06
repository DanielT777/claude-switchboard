import importlib.util
from pathlib import Path
import time
import unittest

spec = importlib.util.spec_from_file_location('supervisor', Path(__file__).parents[1] / 'src/supervisor.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class StopGuard(unittest.TestCase):
    def test_terminal_replies_are_not_user_drafts(self):
        # Arrange
        replies = [b'\x1b[12;34R', b'\x1b[?1;2c', b'\x1b[>0;276;0c',
                   b'\x1b[?0u', b'\x1b[?2026;2$y',
                   b'\x1b[I', b'\x1b[O', b'\x1b]11;rgb:0000/0000/0000\x1b\\']
        # Act
        results = [supervisor.terminal_reply(data) for data in replies + [b''.join(replies)]]
        # Assert
        self.assertTrue(all(results))

    def test_typed_text_keys_and_incomplete_replies_still_block_exit(self):
        # Arrange
        inputs = [b'draft', b'\x1b[A', b'\r', b'\x03', b'\x1b[12;', b'\x1b[12;34Rdraft', b'']
        # Act
        results = [supervisor.terminal_reply(data) for data in inputs]
        # Assert
        self.assertFalse(any(results))

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

#!/usr/bin/env python3
"""Own a Claude PTY so account switching works independently of terminal apps."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import socket
import struct
import sys
import termios
import time
import tty
import uuid


def stop_allowed(record, session_id, last_input_ms):
    return (record.get('sessionId') == session_id
            and record.get('state') in ('idle', 'done')
            and record.get('at', 0) >= last_input_ms
            and time.time() * 1000 - record.get('at', 0) >= 1000)


def main():
    node, cli, account, *args = sys.argv[1:]
    root = Path(os.environ.get('SWITCHBOARD_HOME', Path.home() / '.config/claude-switchboard'))
    directory = root / 'supervisors'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    identity = str(uuid.uuid4())
    # Unix sockets have a small path limit on macOS; the private directory is short.
    import tempfile
    socket_dir = Path(tempfile.mkdtemp(prefix='csb-'))
    socket_path = socket_dir / 's'
    metadata = directory / (identity + '.json')
    state_file = directory / (identity + '.session.json')
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(socket_path))
    os.chmod(socket_path, 0o600)
    server.listen(4)
    original = termios.tcgetattr(0)
    child = None
    master = None
    switching = False
    last_input = 0
    last_output = 0
    exit_code = 0

    def resize(*_):
        if master is not None:
            try:
                size = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack('HHHH', 0, 0, 0, 0))
                fcntl.ioctl(master, termios.TIOCSWINSZ, size)
            except OSError:
                pass

    def launch(arguments, cwd=None):
        nonlocal child, master, last_input
        child, master = pty.fork()
        if child == 0:
            if cwd:
                os.chdir(cwd)
            os.environ['SWITCHBOARD_SUPERVISOR_ID'] = identity
            os.execv(node, [node, cli, *arguments])
        last_input = 0
        resize()

    def state():
        try:
            return json.loads(state_file.read_text())
        except (OSError, ValueError):
            return {}

    def request(message):
        nonlocal switching
        if message.get('id') != identity:
            raise ValueError('Superviseur remplacé.')
        command = message.get('command')
        if command == 'status':
            return {'pid': os.getpid(), 'ready': child is None and switching,
                    'lastInputAt': last_input, 'lastOutputAt': last_output, 'switching': switching}
        if command == 'stop':
            if child is None or switching or time.time() * 1000 - last_output < 750 or not stop_allowed(state(), message.get('sessionId'), last_input):
                raise ValueError('Session occupée, saisie en cours ou état non confirmé.')
            switching = True
            os.write(master, b'/exit\r')
            return {'accepted': True}
        if command == 'start':
            if child is not None or not switching:
                raise ValueError('Un processus occupe encore la session.')
            session_id, receipt = message.get('sessionId'), message.get('receiptId')
            target = message.get('accountId')
            uuid.UUID(session_id)
            uuid.UUID(receipt)
            if target != 'system':
                uuid.UUID(target)
            if state().get('sessionId') != session_id:
                raise ValueError('Conversation remplacée.')
            launch(['resume', target, session_id, receipt, *args], state().get('cwd'))
            switching = False
            return {'accepted': True}
        raise ValueError('Commande inconnue.')

    def terminate(*_):
        raise KeyboardInterrupt

    def write_all(fd, data):
        while data:
            data = data[os.write(fd, data):]

    def output(data):
        write_all(1, data)

    try:
        fd = os.open(metadata, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump({'id': identity, 'socket': str(socket_path), 'pid': os.getpid(),
                       'cwd': os.getcwd(), 'terminal': os.environ.get('TERM_PROGRAM', 'Terminal')}, file)
        signal.signal(signal.SIGWINCH, resize)
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGHUP, terminate)
        launch(['start', account, *args])
        tty.setraw(0)
        while True:
            if child is not None:
                finished, status = os.waitpid(child, os.WNOHANG)
                if finished:
                    exit_code = os.waitstatus_to_exitcode(status)
                    child = None
                    if master is not None:
                        while select.select([master], [], [], 0)[0]:
                            try:
                                data = os.read(master, 65536)
                                if not data:
                                    break
                                output(data)
                            except OSError:
                                break
                    if not switching:
                        break
                    if master is not None:
                        os.close(master)
                        master = None
                    output(b'\r\n[Switchboard] Reprise en cours. Ctrl-D pour revenir au shell.\r\n')
            readers = [0, server]
            if master is not None:
                readers.append(master)
            ready, _, _ = select.select(readers, [], [], 0.1)
            # Process keyboard input before control requests to reject a concurrent draft.
            if 0 in ready:
                data = os.read(0, 65536)
                if not data or (child is None and b'\x04' in data):
                    break
                last_input = time.time() * 1000
                if master is not None and not switching:
                    write_all(master, data)
            if master is not None and master in ready:
                try:
                    data = os.read(master, 65536)
                    if data:
                        last_output = time.time() * 1000
                        output(data)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            if server in ready:
                connection, _ = server.accept()
                with connection:
                    connection.settimeout(1)
                    try:
                        data = b''
                        while b'\n' not in data and len(data) <= 16384:
                            chunk = connection.recv(4096)
                            if not chunk:
                                break
                            data += chunk
                        if len(data) > 16384:
                            raise ValueError('Requête trop volumineuse.')
                        reply = {'ok': True, 'result': request(json.loads(data))}
                    except (ValueError, OSError, TypeError, KeyError):
                        reply = {'ok': False, 'error': 'Session occupée ou commande invalide.' if os.environ.get('SWITCHBOARD_LANG') == 'fr' else 'Session busy or invalid command.'}
                    try:
                        connection.sendall((json.dumps(reply) + '\n').encode())
                    except OSError:
                        pass
    except KeyboardInterrupt:
        exit_code = 130
    finally:
        termios.tcsetattr(0, termios.TCSADRAIN, original)
        if child is not None:
            try:
                os.killpg(child, signal.SIGHUP)
            except ProcessLookupError:
                pass
        if master is not None:
            os.close(master)
        server.close()
        metadata.unlink(missing_ok=True)
        state_file.unlink(missing_ok=True)
        socket_path.unlink(missing_ok=True)
        socket_dir.rmdir()
    return max(0, exit_code)


if __name__ == '__main__':
    sys.exit(main())

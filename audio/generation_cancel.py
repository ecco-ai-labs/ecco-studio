"""Cooperative cancellation with per-job markers and isolated process groups."""
import os
import signal
import subprocess
import time


class Cancelled(Exception):
    pass


def check(directory):
    if (directory / 'cancel.json').exists():
        raise Cancelled('Stopped by user')


def terminate(process):
    # Only processes started with start_new_session=True are accepted here.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    # Also reap children whose parent exited before them.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run(directory, command, *, timeout, check=True, **kwargs):
    globals()['check'](directory)
    process = subprocess.Popen(command, start_new_session=True, **kwargs)
    started = time.monotonic()
    try:
        while process.poll() is None:
            globals()['check'](directory)
            if time.monotonic() - started > timeout:
                raise subprocess.TimeoutExpired(command, timeout)
            time.sleep(.2)
        globals()['check'](directory)
        if check and process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
        return subprocess.CompletedProcess(command, process.returncode)
    except BaseException:
        terminate(process)
        raise

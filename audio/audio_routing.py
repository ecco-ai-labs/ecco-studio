"""Validated instance identity and bounded CPU resources; no credentials."""
import os
from pathlib import Path
import re

def worker_id(value):
    if value in (None, ''):
        return ''
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise ValueError('Choose a valid audio worker instance.')
    return value

def memory_bytes():
    values = []
    for name in ('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'):
        try:
            text = Path(name).read_text().strip()
            if text.isdigit():
                values.append(int(text))
        except OSError:
            pass
    try:
        values.append(os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE'))
    except (OSError, ValueError):
        pass
    return min(values) if values else 0

def cpu_count():
    count = len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else os.cpu_count() or 1
    try:
        quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota != 'max':
            count = min(count, max(1, int(quota) // int(period)))
    except (OSError, ValueError):
        pass
    return count

def sound_memory_ready():
    return memory_bytes() >= 16 * 1024**3

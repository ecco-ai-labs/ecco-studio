"""Cheap local worker health facts. No model loading, downloads or credentials."""
import os
from pathlib import Path
import shutil
import time
from audio_routing import memory_bytes

def snapshot(root):
    total = memory_bytes()
    free = []
    try:
        fields = {line.split(':')[0]: int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines()}
        free.append(fields['MemAvailable'])
    except (OSError, ValueError, KeyError):
        pass
    for limit, current in [('/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.current'),('/sys/fs/cgroup/memory/memory.limit_in_bytes','/sys/fs/cgroup/memory/memory.usage_in_bytes')]:
        try:
            cap = Path(limit).read_text().strip()
            if cap.isdigit(): free.append(max(0, int(cap)-int(Path(current).read_text())))
        except (OSError, ValueError):
            pass
    result = {'version':1,'checked_at':time.time(),'memory_total_bytes':total,'memory_available_bytes':min(free) if free else None,
              'ffmpeg':bool(shutil.which('ffmpeg')),'ffprobe':bool(shutil.which('ffprobe'))}
    for name, path in [('queue',root),('temporary','/tmp')]:
        try: result[name+'_free_bytes'] = shutil.disk_usage(path).free
        except OSError: result[name+'_free_bytes'] = None
    return result

"""Wire the generation queue (gen_queue.py) into a copy of studio.py. Safe to run twice.

Usage: python3 apply_queue_patch.py /workspace/ecco-studio/studio.py
Keeps a backup next to the file (studio.py.before-queue-<time>) and stops without writing if an anchor is missing.
"""
import re
import shutil
import sys
import time
from pathlib import Path

MARK = '# gen_queue wired'


def patch(src):
    if MARK in src:
        return src, []
    done = []

    # 1. launch(): picture jobs skip the 8-job limit and go to the queue instead of the one-worker pool.
    limit = re.search(r"\n(?P<i> +)if len\(\[j for j in records\('job'\) if j\['status'\] in \('queued','running'\)\]\)>=8: raise Problem\('Queue is full',429\)\n"
                      r"(?P=i)job=save\(new\('job',label=label,status='queued',(?P<rest>[^\n]*)\)\)\n", src)
    if not limit:
        raise SystemExit('anchor missing: launch() queue limit')
    i = limit['i']
    src = src[:limit.start()] + (
        f"\n{i}queued=__import__('gen_queue').wants(metadata)  {MARK}\n"
        f"{i}if not queued and len([j for j in records('job') if j['status'] in ('queued','running')])>=8: raise Problem('Queue is full',429)\n"
        f"{i}reuse=__import__('gen_queue').reuse_id() if queued else None\n"
        f"{i}if reuse:\n{i}    job=get(reuse,'job'); job.update(status='queued',error='',progress='Waiting in the queue',cancel_requested=False); save(job)\n"
        f"{i}else: job=save(new('job',label=label,status='queued',{limit['rest']}))\n") + src[limit.end():]
    done.append('launch limit')

    pool = re.search(r"\n    POOL\.submit\(run\)\n    return job\n", src)
    if not pool:
        raise SystemExit('anchor missing: POOL.submit(run)')
    src = src[:pool.start()] + "\n    if queued: return __import__('gen_queue').enqueue(job,run,label)\n    POOL.submit(run)\n    return job\n" + src[pool.end():]
    done.append('launch pool')

    # 2. initialize(): table, restart recovery and the dispatcher, after old jobs were marked interrupted.
    init = re.search(r"(def initialize\(\):\n(?:    [^\n]*\n|\n)+?)(?=\S)", src)
    if not init:
        raise SystemExit('anchor missing: initialize()')
    body = init.group(1).rstrip('\n') + "\n    __import__('gen_queue').install(globals(), DATA / 'studio.sqlite')\n\n"
    src = src[:init.start()] + body + src[init.end():]
    done.append('initialize')

    # 3. mutate(): remember who sent a picture job, and the owner's queue actions.
    for path, kind in (("/api/images", 'image'), ("/api/image-edits", 'edit')):
        m = re.search(r"(if|elif) path=='" + re.escape(path) + r"': result=(\w+)\(body\)", src)
        if not m:
            raise SystemExit('anchor missing: route ' + path)
        src = src[:m.start()] + f"{m[1]} path=='{path}': __import__('gen_queue').remember_request('{kind}',body); result={m[2]}(body)" + src[m.end():]
        done.append('route ' + path)
    m = re.search(r"\n(?P<i> +)elif path=='/api/image-edits':", src)
    i = m['i']
    extra = (f"\n{i}elif path=='/api/queue/move': result=__import__('gen_queue').move(body.get('owner'),body.get('job_id'),body.get('before_id'),bool(body.get('top')))"
             f"\n{i}elif path=='/api/queue/cancel': result=__import__('gen_queue').cancel(body.get('owner'),[str(x) for x in body.get('job_ids',[])][:500])"
             f"\n{i}elif path=='/api/queue/cancel-all': result=__import__('gen_queue').cancel_all(body.get('owner'))")
    src = src[:m.start()] + extra + src[m.start():]
    done.append('queue routes')
    return src, done


def main(target):
    path = Path(target)
    src = path.read_text()
    new, done = patch(src)
    if not done:
        print('already wired')
        return
    compile(new, str(path), 'exec')
    backup = path.with_name(path.name + '.before-queue-' + time.strftime('%Y%m%d%H%M%S'))
    shutil.copy2(path, backup)
    path.write_text(new)
    print('wired:', ', '.join(done), '| backup:', backup.name)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'studio.py')

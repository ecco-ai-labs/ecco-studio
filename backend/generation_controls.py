"""Stop one authenticated workspace job without affecting other generations."""
import audio_jobs
import audio_video_sequence
import longcat_jobs


def stop(body, env):
    job = env['get'](body.get('job_id', ''))
    kind = job.get('kind')
    if kind == 'character_job':
        import character_studio
        return character_studio.cancel(job['id'], env)
    if kind == 'audio_job':
        return audio_jobs.cancel(job['id'], env)
    if kind == 'longcat_job':
        return longcat_jobs.cancel(job['id'], env)
    if kind == 'audio_video_job':
        return audio_video_sequence.cancel(job['id'], env)
    if kind != 'job' or not (job.get('video_job') or job.get('media') in ('image', 'video') or
                            job.get('label', '').startswith(('Generate ', 'Edit ', 'Character ', 'Instruction edit'))):
        raise env['Problem']('Choose an image, audio or video generation.')
    with env['LOCK']:
        job = env['get'](job['id'], 'job')
        if job.get('status') not in ('queued', 'running', 'cancelling'):
            return job
        audio_jobs.queue.write(env['DATA']/'generation-control'/job['id']/'cancel.json', {'reason':'Stopped by user'})
        # The owning GPU observes this shared record and cancels only its prompt.
        env['job_update'](job['id'], cancel_requested=True, progress='Stopping…', stage='Stopping…')
        return env['get'](job['id'], 'job')

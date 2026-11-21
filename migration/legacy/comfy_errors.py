"""Plain-language reasons for failed ComfyUI / Serverless jobs.

The Serverless proxy puts the real reason in the history entry (execution_error.exception_message);
Studio used to show only "Comfy generation failed", which hid problems such as a refused RunPod key
(owner report 19 Nov 2026).
"""

GENERIC = 'Comfy generation failed. Inspect Comfy server log.'


def detail(entry):
    for message in (entry or {}).get('status', {}).get('messages') or []:
        if isinstance(message, (list, tuple)) and len(message) > 1 and message[0] == 'execution_error' \
                and isinstance(message[1], dict):
            return str(message[1].get('exception_message') or '').strip()
    return ''


def describe(entry):
    text = detail(entry)
    lowered = text.lower()
    if 'http 401' in lowered or 'http 403' in lowered:
        return ('RunPod refused the API key. Check ECCO_RUNPOD_API_KEY on the storage pod: '
                'it needs Serverless endpoints Read and Write.')
    if 'too large' in lowered:
        return 'The pictures are too large to send to Serverless. Try smaller pictures.'
    if 'not configured' in lowered:
        return 'This Serverless endpoint is not configured on the storage pod.'
    return f'Generation failed: {text[:300]}' if text else GENERIC

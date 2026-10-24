"""Persist the reviewed audio preparation together with its story."""
import json
import time

FIELDS = ('model', 'title', 'genre', 'audience', 'language', 'language_style',
          'language_style_instructions', 'tone', 'purpose', 'instructions', 'turns',
          'source_text', 'source_scope', 'source_name', 'source_pages', 'source_selection',
          'opening', 'opening_instructions', 'closing_instructions', 'opening_pause',
          'cast', 'plan', 'sound_design', 'cast_reason')

def save(body, env):
    prep = body.get('audio_preparation')
    if prep is None:
        return env['create_story'](body)
    if not isinstance(prep, dict) or len(json.dumps(prep)) > 150000:
        raise env['Problem']('The audio story preparation is invalid or too large.')
    cast, plan = prep.get('cast'), prep.get('plan')
    if not isinstance(cast, list) or not 1 <= len(cast) <= 20 or not isinstance(plan, dict):
        raise env['Problem']('Review the characters and script before saving.')
    if any(not isinstance(c, dict) or not isinstance(c.get('id'), str) or not isinstance(c.get('name'), str) or not c['name'].strip() for c in cast):
        raise env['Problem']('Each character needs an identity and a name.')
    ids = {c['id'] for c in cast}
    if len(ids) != len(cast) or len({c['name'].strip().casefold() for c in cast}) != len(cast):
        raise env['Problem']('Use distinct character identities and names.')
    parts = plan.get('segments')
    if not isinstance(parts, list) or not 1 <= len(parts) <= 20:
        raise env['Problem']('Review the spoken turns before saving.')
    parts = ([plan['opening']] if plan.get('opening') else []) + parts
    if any(not isinstance(p, dict) or p.get('character_id') not in ids or not isinstance(p.get('text'), str) or not p['text'].strip() for p in parts):
        raise env['Problem']('Each spoken turn needs a character and text.')
    if sum(len(p['text']) for p in parts) > 4000:
        raise env['Problem']('Keep the spoken script within 4,000 characters.')
    clean = {k: prep[k] for k in FIELDS if k in prep}
    title = env['text'](body.get('title'), 160)
    summary = str(body.get('summary', ''))
    if len(summary) > 6500:
        raise env['Problem']('The character-labelled script is too long.')
    with env['LOCK']:
        story = env['get'](body['story_id'], 'story') if body.get('story_id') else env['new']('story')
        if story.get('deleted'):
            raise env['Problem']('Restore this story before saving changes.')
        story.update(title=title, summary=summary, story_format='audio',
                     audio_preparation=clean, updated=time.time())
        return env['save'](story)

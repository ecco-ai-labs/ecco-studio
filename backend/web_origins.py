"""Explicit configured website origins. Never reflect arbitrary request origins."""
import os
from urllib.parse import urlsplit

DEV_ORIGIN = 'https://ecco-ai-labs.github.io'


def allowed_origins():
    values = os.getenv('ECCO_ALLOWED_ORIGINS', DEV_ORIGIN).split(',')
    origins = set()
    for value in values:
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('ECCO_ALLOWED_ORIGINS must contain exact HTTPS origins without paths.')
        origins.add(value)
    return origins


def request_origin(headers):
    origin = headers.get('Origin')
    return origin if origin in allowed_origins() else ''

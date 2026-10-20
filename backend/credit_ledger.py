"""Credit ledger for a future authenticated account service.

The caller must supply a server-verified subject, never a client-provided email.
Not mounted on the shared-key storage API: that API cannot identify users.
"""
import sqlite3
import time


class CreditLedger:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = path, clock
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS credits (subject TEXT PRIMARY KEY, balance INTEGER NOT NULL, used INTEGER NOT NULL, remainder REAL NOT NULL, last_seen REAL)')

    def heartbeat(self, verified_subject):
        if not isinstance(verified_subject, str) or not verified_subject.strip():
            raise ValueError('Verified account subject required')
        now = self.clock()
        with sqlite3.connect(self.path, timeout=15) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO credits VALUES (?,500,0,0,NULL)', (verified_subject,))
            balance, used, remainder, last = db.execute('SELECT balance,used,remainder,last_seen FROM credits WHERE subject=?', (verified_subject,)).fetchone()
            # One account clock prevents duplicate tabs charging twice.
            # A missing heartbeat over 90 seconds ends the observed usage session.
            if last is not None and 0 <= now-last <= 90:
                remainder += now-last
            charge = min(balance, int(remainder // 60) * 100)
            remainder %= 60
            balance -= charge
            used += charge
            db.execute('UPDATE credits SET balance=?,used=?,remainder=?,last_seen=? WHERE subject=?', (balance,used,remainder,now,verified_subject))
            return {'balance': balance, 'used': used, 'rate_per_minute': 100, 'low': balance <= 100}

    def end_session(self, verified_subject):
        result = self.heartbeat(verified_subject)
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE credits SET last_seen=NULL WHERE subject=?', (verified_subject,))
        return result

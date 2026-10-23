"""WeChat code exchange, opaque sessions, ownership and persistent request quotas."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

SESSION_TTL = 7200


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class WeChatLogin:
    def __init__(self, app_id: str, app_secret: str):
        if not re.fullmatch(r'wx[0-9a-f]{16}', app_id) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', app_secret):
            raise ValueError('Invalid server-side WeChat credentials')
        self.app_id, self.app_secret = app_id, app_secret

    def __call__(self, code: str) -> str:
        query = urllib.parse.urlencode({'appid': self.app_id, 'secret': self.app_secret,
                                       'js_code': code, 'grant_type': 'authorization_code'})
        # Fixed destination; never forward the secret to a redirect or log its URL.
        try:
            with urllib.request.build_opener(NoRedirect()).open(
                    'https://api.weixin.qq.com/sns/jscode2session?' + query, timeout=10) as response:
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise ValueError('Oversized login response')
                result = json.loads(raw)
        except Exception:
            raise HTTPException(503, '暂时无法登录，请稍后重试') from None
        if not isinstance(result, dict):
            raise HTTPException(503, '暂时无法登录，请稍后重试')
        if result.get('errcode') in (40029, 40163):
            raise HTTPException(401, '登录已过期，请重试')
        if result.get('errcode') == 45011:
            raise HTTPException(429, '操作太频繁，请稍后重试', headers={'Retry-After': '60'})
        openid = result.get('openid')
        if result.get('errcode') or not isinstance(openid, str) or not 1 <= len(openid) <= 128:
            raise HTTPException(503, '暂时无法登录，请稍后重试')
        # Neither openid nor WeChat session_key is sent to the client or persisted.
        return digest(self.app_id + ':' + openid)


class AccessStore:
    def __init__(self, database: Path, clock=time.time):
        self.database, self.clock = str(database), clock
        database.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS quotas (scope TEXT NOT NULL, subject TEXT NOT NULL, bucket INTEGER NOT NULL,
                    count INTEGER NOT NULL, expires REAL NOT NULL, PRIMARY KEY(scope, subject, bucket));
                CREATE TABLE IF NOT EXISTS owners (filename TEXT PRIMARY KEY, subject TEXT NOT NULL, expires REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
                CREATE INDEX IF NOT EXISTS quotas_expiry ON quotas(expires);
                CREATE INDEX IF NOT EXISTS owners_expiry ON owners(expires);
            ''')
        try:
            os.chmod(database, 0o600)
        except OSError:
            pass

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def prune(self):
        with self.connect() as db:
            for table in ('sessions', 'quotas', 'owners'):
                db.execute(f'DELETE FROM {table} WHERE expires <= ?', (self.clock(),))

    def issue(self, subject: str) -> dict:
        token = secrets.token_urlsafe(32)
        now = self.clock()
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (now,))
            db.execute('INSERT INTO sessions VALUES (?,?,?)', (digest(token), subject, now + SESSION_TTL))
        return {'token': token, 'expiresIn': SESSION_TTL}

    def identify(self, token: str) -> str | None:
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            return None
        with self.connect() as db:
            row = db.execute('SELECT subject FROM sessions WHERE token_hash=? AND expires>?',
                             (digest(token), self.clock())).fetchone()
        return row[0] if row else None

    def consume(self, scope: str, subject: str, limit: int, seconds: int):
        now = self.clock()
        bucket = int(now // seconds)
        with self.connect() as db:
            # One transaction makes the check/increment atomic across requests and workers.
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM quotas WHERE expires <= ?', (now,))
            row = db.execute('SELECT count FROM quotas WHERE scope=? AND subject=? AND bucket=?',
                             (scope, subject, bucket)).fetchone()
            if row and row[0] >= limit:
                retry = max(1, int((bucket + 1) * seconds - now + 0.999))
                raise HTTPException(429, '操作次数较多，请稍后再试', headers={'Retry-After': str(retry)})
            db.execute('INSERT INTO quotas VALUES (?,?,?,?,?) ON CONFLICT(scope,subject,bucket) DO UPDATE SET count=count+1',
                       (scope, subject, bucket, 1, (bucket + 1) * seconds))

    def own(self, filename: str, subject: str, ttl: int):
        with self.connect() as db:
            db.execute('INSERT INTO owners VALUES (?,?,?)', (filename, subject, self.clock() + ttl))

    def permits(self, filename: str, subject: str) -> bool:
        with self.connect() as db:
            row = db.execute('SELECT 1 FROM owners WHERE filename=? AND subject=? AND expires>?',
                             (filename, subject, self.clock())).fetchone()
        return bool(row)


def positive_setting(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not 1 <= value <= 100000:
        raise ValueError(f'{name} must be between 1 and 100000')
    return value

"""Local model admission; neither APKs nor decoded weights belong in Git."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import zipfile

ASSET = 'assets/main_segment.bin'
ASSET_SIZE = 3_363_744
ASSET_SHA256 = '580071c82378562567b73fa7445b1b0c1b24796d147873a424268cf8f6810835'
MODEL_SIZE = ASSET_SIZE - 8
MODEL_SHA256 = 'a8a1440ef66d6a99255a361b6884097a0a3da17ffcf720c655c72674ee9f7135'
DEFAULT_PATH = Path(__file__).resolve().parent / '.runtime' / 'nosh' / 'main_segment.mnn'


def model_path() -> Path:
    return Path(os.getenv('FELT_NOSH_MODEL', str(DEFAULT_PATH)))


def verify_model(path: Path) -> Path:
    if not path.is_file() or path.stat().st_size != MODEL_SIZE:
        raise ValueError('Missing nosh model; run python -m backend.prepare_nosh_model --apk <local-apk>')
    if hashlib.sha256(path.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError('nosh model SHA-256 does not match the verified 1.3.0 asset')
    return path


def import_model(source: Path, destination: Path, *, apk: bool) -> Path:
    if apk:
        with zipfile.ZipFile(source) as archive:
            if archive.getinfo(ASSET).file_size != ASSET_SIZE:
                raise ValueError('Unexpected nosh model asset size')
            raw = archive.read(ASSET)
        if hashlib.sha256(raw).hexdigest() != ASSET_SHA256:
            raise ValueError('nosh APK model asset SHA-256 mismatch')
        payload = bytes(value ^ 0x91 for value in raw)[8:]
    else:
        payload = verify_model(source).read_bytes()
    if len(payload) != MODEL_SIZE or hashlib.sha256(payload).hexdigest() != MODEL_SHA256:
        raise ValueError('Decoded nosh model SHA-256 mismatch')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.tmp')
    try:
        temporary.write_bytes(payload)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return verify_model(destination)

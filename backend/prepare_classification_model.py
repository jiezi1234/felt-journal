"""Download or import the pinned, small CPU classification model."""
import argparse
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

from backend.classification import MODEL_URL, model_path, verify_model


def install(source=None):
    target = model_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='classifier-', suffix='.onnx', dir=target.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            if source:
                with verify_model(source).open('rb') as incoming:
                    shutil.copyfileobj(incoming, output)
            else:
                with urllib.request.urlopen(MODEL_URL, timeout=60) as incoming:
                    total = 0
                    while chunk := incoming.read(1024 * 1024):
                        total += len(chunk)
                        if total > 20 * 1024 * 1024:
                            raise ValueError('Classification model download too large')
                        output.write(chunk)
        verify_model(temporary)
        # Readable by the non-root Docker runtime after a host-side import.
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
        return target
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--download', action='store_true')
    group.add_argument('--model', type=Path, help='Import an already downloaded, checksum-verified model')
    args = parser.parse_args()
    path = install(args.model)
    print(f'Classification model ready: {path}')


if __name__ == '__main__':
    main()

"""Import a caller-supplied APK/model into the ignored local runtime cache."""
import argparse
from pathlib import Path

from backend.nosh_model import import_model, model_path, MODEL_SHA256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--apk', type=Path, help='Local nosh 1.3.0 APK (including .apk.1)')
    source.add_argument('--mnn', type=Path, help='Already decoded, verified model for offline deployment')
    parser.add_argument('--output', type=Path, default=model_path())
    args = parser.parse_args()
    destination = import_model(args.apk or args.mnn, args.output, apk=args.apk is not None)
    print(f'Verified model ready: {destination}\nSHA-256: {MODEL_SHA256}')


if __name__ == '__main__':
    main()

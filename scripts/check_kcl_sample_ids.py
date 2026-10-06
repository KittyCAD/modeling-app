#!/usr/bin/env python3
"""Require a valid, unique project identity for every KCL sample (Python 3.11+)."""

import argparse
from pathlib import Path
import sys
import tomllib
import uuid


def sample_ids(root):
    identities = {}
    owners = {}
    errors = []
    # Discover samples on disk, not just in the generated manifest: new samples
    # must pass even before their manifest entry has been generated.
    directories = sorted(p for p in root.iterdir() if p.is_dir() and any(p.rglob("*.kcl")))
    for directory in directories:
        project = directory / "project.toml"
        try:
            with project.open("rb") as source:
                configuration = tomllib.load(source)
            value = configuration.get("settings", {}).get("meta", {}).get("id")
            if not isinstance(value, str):
                raise ValueError("settings.meta.id must be a UUID string")
            identity = uuid.UUID(value)
            if not identity.int or str(identity) != value.lower():
                raise ValueError("settings.meta.id must be a nonzero UUID in hyphenated form")
        except (OSError, ValueError, AttributeError) as error:
            errors.append(f"{directory.name}/project.toml: {error}")
            continue
        identity = str(identity)
        if identity in owners:
            errors.append(f"{directory.name}: UUID {identity} is also used by {owners[identity]}")
        owners[identity] = directory.name
        identities[directory.name] = identity
    if errors:
        raise ValueError("\n".join(errors))
    return identities


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples-root", type=Path, default=Path("public/kcl-samples"))
    args = parser.parse_args()
    identities = sample_ids(args.samples_root)
    print(f"Validated {len(identities)} KCL samples with unique project UUIDs.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Invalid sample identities:\n{error}", file=sys.stderr)
        sys.exit(1)

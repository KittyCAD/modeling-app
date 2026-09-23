"""Export Instruments field definitions, never trace rows or their values."""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import TypedDict

IDENTIFIER = re.compile(r"[a-z][a-z0-9_-]{0,79}\Z")
SCHEMA_PREFIXES = (
    "thread-",
    "time-",
    "cpu-",
    "system-",
    "metal-",
    "gpu-",
    "display-",
    "process-",
    "kdebug-",
    "syscall-",
    "kernel-",
    "os-signpost-",
)
MAX_XML_BYTES = 32 * 1024 * 1024


class ColumnDefinition(TypedDict):
    mnemonic: str | None
    engineeringType: str | None
    type: str | None


class SchemaSummary(TypedDict):
    calibrationEligible: bool
    timingEvidence: str
    traceRowsPublished: bool
    schemaIdentifiers: list[str]
    schemaLimitExceeded: bool
    omittedTableCount: int
    sampleSchemaStatus: str
    sampleColumns: list[ColumnDefinition]
    columnLimitExceeded: bool


class SchemaError(TypedDict):
    calibrationEligible: bool
    timingEvidence: str
    error: str


def read_xml(file: Path) -> ET.Element:
    if file.stat().st_size > MAX_XML_BYTES:
        raise ValueError("xml-size-limit")
    return ET.parse(file).getroot()


def safe_identifier(value: str | None) -> str | None:
    return value if value is not None and IDENTIFIER.fullmatch(value) else None


def summarize(directory: Path) -> SchemaSummary:
    toc = read_xml(directory / "toc.xml")
    schemas: set[str] = set()
    omitted = 0
    for table in toc.iter("table"):
        schema = safe_identifier(table.get("schema"))
        if schema and schema.startswith(SCHEMA_PREFIXES):
            schemas.add(schema)
        else:
            omitted += 1
    columns: list[ColumnDefinition] = []
    sample_status = "unavailable"
    sample_file = directory / "sample.xml"
    if sample_file.exists():
        try:
            sample = read_xml(sample_file)
            for schema in sample.iter("schema"):
                if schema.get("name") != "time-sample":
                    continue
                for column in schema.findall("col"):
                    # Only Instruments' schema definition fields are read.
                    # No row, formatted value, process name, or backtrace is exported.
                    fields: ColumnDefinition = {
                        "mnemonic": safe_identifier(column.findtext("mnemonic")),
                        "engineeringType": safe_identifier(
                            column.findtext("engineering-type")
                        ),
                        "type": safe_identifier(column.findtext("type")),
                    }
                    if any(fields.values()):
                        columns.append(fields)
            sample_status = "definitions-only" if columns else "unsupported-schema"
        except (OSError, ValueError, ET.ParseError):
            sample_status = "invalid-or-unavailable-export"
    return {
        "calibrationEligible": False,
        "timingEvidence": "unavailable-schema-not-interpreted",
        "traceRowsPublished": False,
        "schemaIdentifiers": sorted(schemas)[:64],
        "schemaLimitExceeded": len(schemas) > 64,
        "omittedTableCount": omitted,
        "sampleSchemaStatus": sample_status,
        "sampleColumns": columns[:32],
        "columnLimitExceeded": len(columns) > 32,
    }


def main() -> int:
    directory = Path(sys.argv[1])
    report: SchemaSummary | SchemaError
    try:
        report = summarize(directory)
    except (OSError, ValueError, ET.ParseError):
        report = {
            "calibrationEligible": False,
            "timingEvidence": "unavailable-schema-not-interpreted",
            "error": "invalid-or-unavailable-toc",
        }
    try:
        (directory / "schema.json").write_text(json.dumps(report, indent=2) + "\n")
    except OSError:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - This CLI must not expose unexpected parser errors.
        # Never leak parser errors, raw XML, arguments, or paths to CI logs.
        sys.exit(1)

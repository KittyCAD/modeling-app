#!/usr/bin/env python3

"""Tag KCL test results in a JUnit report with the versions they executed.

A test that sets `kcl_versions` in its `config.toml` executes its
`input.kcl` once per version, but nextest reports a single test case for all of
them. Tagging that test case lets a report reader easily tell which versions ran.

KCL sample tests under `public/kcl-samples` are tagged the same way using the
`kclVersion` from each sample's `main.kcl`.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REPORT = Path("test-results/junit.xml")

SIM_TESTS = Path("rust/kcl-lib/tests")
CONFIG_VERSIONS = re.compile(r"^kcl_versions\s*=\s*(\[[^\]]*\])", re.MULTILINE)

SAMPLE_TESTS = Path("public/kcl-samples")
SAMPLE_NAME = re.compile(
    r"^simulation_tests::kcl_samples::(?:parse|unparse|kcl_test_execute)_(.+)$"
)
ENTRY_VERSION = re.compile(
    r"kclVersion\s*=\s*([0-9]+(?:\.[0-9]+)*(?:-[A-Za-z0-9]+)?)"
)

def versions_by_test(tests_dir: Path) -> dict[str, list[str]]:
    versions = {}
    for config_file in sorted(tests_dir.glob("*/config.toml")):
        match = CONFIG_VERSIONS.search(config_file.read_text())
        if match:
            versions[config_file.parent.name] = json.loads(match.group(1))
    return versions


def sanitize_sample_name(name: str) -> str:
    sanitized = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    return sanitized.lstrip("_").lower()


def versions_by_sample(samples_dir: Path) -> dict[str, list[str]]:
    versions = {}
    if not samples_dir.is_dir():
        return versions
    for main_kcl in sorted(samples_dir.glob("*/main.kcl")):
        match = ENTRY_VERSION.search(main_kcl.read_text())
        if match:
            versions[sanitize_sample_name(main_kcl.parent.name)] = [match.group(1)]
    return versions


def tag_test_case(test_case: ET.Element, kcl_versions: list[str]) -> None:
    properties = test_case.find("properties")
    if properties is None:
        properties = ET.Element("properties")
        test_case.insert(0, properties)
    tagged = {
        property.get("value")
        for property in properties.findall("property")
        if property.get("name") == "tag"
    }
    for version in kcl_versions:
        tag = f"kcl-{version}"
        if tag not in tagged:
            ET.SubElement(properties, "property", {"name": "tag", "value": tag})


def main() -> int:
    sim_versions = versions_by_test(SIM_TESTS)
    sample_versions = versions_by_sample(SAMPLE_TESTS)
    if not sim_versions and not sample_versions:
        return 0

    tree = ET.parse(REPORT)
    tagged_count = 0
    for test_case in tree.iter("testcase"):
        name = test_case.get("name", "")
        for test_name, kcl_versions in sim_versions.items():
            if name == f"simulation_tests::{test_name}::kcl_test_execute":
                tag_test_case(test_case, kcl_versions)
                tagged_count += 1
                break
        else:
            sample_match = SAMPLE_NAME.match(name)
            if sample_match:
                kcl_versions = sample_versions.get(sample_match.group(1))
                if kcl_versions:
                    tag_test_case(test_case, kcl_versions)
                    tagged_count += 1

    if tagged_count:
        ET.indent(tree, space="    ")
        tree.write(REPORT, encoding="UTF-8", xml_declaration=True)
    print(f"Tagged {tagged_count} test case(s) with KCL versions")
    return 0


if __name__ == "__main__":
    sys.exit(main())

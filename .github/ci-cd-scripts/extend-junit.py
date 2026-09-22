#!/usr/bin/env python3

"""Tag KCL test results in a JUnit report with the versions they executed.

A test that sets `kcl_versions` in its `config.toml` executes its
`input.kcl` once per version, but nextest reports a single test case for all of
them. Tagging that test case lets a report reader easily tell which versions ran.
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REPORT = Path("test-results/junit.xml")
TESTS = Path("rust/kcl-lib/tests")
KCL_VERSIONS = re.compile(r"^kcl_versions\s*=\s*(\[[^\]]*\])", re.MULTILINE)


def versions_by_test(tests_dir: Path) -> dict[str, list[str]]:
    versions = {}
    for config_file in sorted(tests_dir.glob("*/config.toml")):
        match = KCL_VERSIONS.search(config_file.read_text())
        if match:
            versions[config_file.parent.name] = json.loads(match.group(1))
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
    versions = versions_by_test(TESTS)
    if not versions:
        return 0

    tree = ET.parse(REPORT)
    tagged_count = 0
    for test_case in tree.iter("testcase"):
        name = test_case.get("name", "")
        for test_name, kcl_versions in versions.items():
            if name == f"simulation_tests::{test_name}::kcl_test_execute":
                tag_test_case(test_case, kcl_versions)
                tagged_count += 1

    if tagged_count:
        ET.indent(tree, space="    ")
        tree.write(REPORT, encoding="UTF-8", xml_declaration=True)
    print(f"Tagged {tagged_count} test case(s) with KCL versions")
    return 0


if __name__ == "__main__":
    sys.exit(main())

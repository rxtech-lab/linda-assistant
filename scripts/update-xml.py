#!/usr/bin/env python3
import sys
import xml.etree.ElementTree as ET
from typing import Optional


SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle"


def update_appcast(xml_file: str, notes_path: str, build_number: Optional[str]) -> None:
    ET.register_namespace("sparkle", SPARKLE_NS)

    tree = ET.parse(xml_file)
    root = tree.getroot()
    namespaces = {"sparkle": SPARKLE_NS}

    channel = root.find("channel")
    if channel is None:
        raise RuntimeError("Invalid appcast.xml: channel element not found")

    for item in channel.findall("item"):
        release_notes_link = item.find(".//sparkle:releaseNotesLink", namespaces)
        if release_notes_link is None:
            release_notes_link = ET.Element(f"{{{SPARKLE_NS}}}releaseNotesLink")
            release_notes_link.text = notes_path
            item.insert(0, release_notes_link)

        if build_number:
            version_element = item.find(".//sparkle:version", namespaces)
            if version_element is None:
                version_element = ET.Element(f"{{{SPARKLE_NS}}}version")
                version_element.text = build_number
                item.insert(1, version_element)
            else:
                version_element.text = build_number

    tree.write(xml_file, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python update-xml.py <path_to_appcast.xml> <path_to_release_notes> [build_number]")
        sys.exit(1)

    xml_file = sys.argv[1]
    notes_path = sys.argv[2]
    build_number = sys.argv[3] if len(sys.argv) > 3 else None

    update_appcast(xml_file, notes_path, build_number)

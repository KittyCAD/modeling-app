"""Desktop executor protocol: Python source on stdin, SVG pages on stdout."""

import contextlib
import json
import os
import sys
from pathlib import Path

import pymupdf
from pyorigami import Diagram, render
from pyorigami import ps as ps_writer

request = json.load(sys.stdin)
model = inspect_authoring(request["contents"])
original_write_step = ps_writer._write_step


def write_authoring_step(out, step, *args, **kwargs):
    original_write_step(out, step, *args, **kwargs)
    urx, ury = args[2:4]
    # Invisible PDF links retain caption rectangles through PostScript layout.
    # They are metadata only: the SVG image never exposes navigable links.
    for index in range(max(1, len(step.captions))):
        row = index + 1
        out.write(
            f"[ /Rect [ {-urx * 0.65} mm {-ury} mm interline hline add {row} mul sub 4 sub "
            f"{urx} mm {-ury} mm interline hline add {row} mul sub 12 add ] "
            f"/Action << /Subtype /URI /URI (https://pyorigami.invalid/caption/{int(step.index) - 1}/{index}) >> "
            "/Subtype /Link /Border [0 0 0] /ANN pdfmark\n"
        )


ps_writer._write_step = write_authoring_step
namespace = {"__name__": "__main__", "__file__": request["src"]}
# User prints and library diagnostics must not corrupt the JSON response.
with contextlib.redirect_stdout(sys.stderr):
    exec(compile(request["contents"], request["src"], "exec"), namespace)
    diagram = namespace.get("diagram")
    if not isinstance(diagram, Diagram):
        raise TypeError("Define a pyorigami Diagram in a variable named 'diagram'.")
    # pyorigami's SVG converter only exports page zero. Convert the complete PDF.
    # Doodle lays out A4 pages; Ghostscript's platform default can be Letter.
    os.environ["GS_OPTIONS"] = "-sPAPERSIZE=a4"
    pdf = render(diagram, "pdf", Path("diagram.pdf"), native=True)
    with pymupdf.open(pdf) as document:
        pages = [page.get_svg_image() for page in document]
        fields = []

        def add_field(page_index, rect, target, field):
            page = document[page_index]
            rect = rect & page.rect
            fields.append({
                "page": page_index, "target": target, **field,
                "x": rect.x0 / page.rect.width, "y": rect.y0 / page.rect.height,
                "width": rect.width / page.rect.width, "height": rect.height / page.rect.height,
            })

        if not model.get("error"):
            first = document[0]
            spans = [span for block in first.get_text("dict")["blocks"] if "lines" in block
                     for line in block["lines"] for span in line["spans"]]
            for prop, prefix, fallback in (
                ("title", None, (55, 38, first.rect.width - 55, 75)),
                ("designer", "Design:", (55, 87, first.rect.width / 2 - 10, 110)),
                ("diagrammer", "Diagrams:", (first.rect.width / 2 + 10, 87, first.rect.width - 55, 110)),
                ("colorFront", None, (55, 128, 175, 150)),
                ("colorBack", None, (185, 128, 305, 150)),
            ):
                rect = pymupdf.Rect(fallback)
                matches = [span for span in spans if (prefix and span["text"].startswith(prefix)) or
                           (prop == "title" and span["size"] >= 20)]
                if matches:
                    rect = pymupdf.Rect(matches[0]["bbox"])
                    rect.x0 -= 4
                    rect.x1 = max(rect.x1 + 4, rect.x0 + 120)
                    rect.y0 -= 3
                    rect.y1 += 3
                if prop == "designer":
                    rect.x1 = first.rect.width / 2 - 10
                elif prop == "diagrammer":
                    rect.x0 = first.rect.width / 2 + 10
                    rect.x1 = first.rect.width - 55
                add_field(0, rect, {"kind": "property", "property": prop}, model["properties"][prop])
            for page_index, page in enumerate(document):
                for link in page.get_links():
                    uri = link.get("uri", "")
                    if uri.startswith("https://pyorigami.invalid/caption/"):
                        step, caption = map(int, uri.rsplit("/", 2)[-2:])
                        if step >= len(model["steps"]):
                            continue
                        captions = model["steps"][step]["captions"]
                        field = captions[caption] if caption < len(captions) else {"value": "", "editable": True}
                        add_field(page_index, link["from"], {"kind": "caption", "step": step, "caption": caption}, field)
        authoring = {"fields": fields, "canAddStep": model["canAddStep"]}
        if model.get("error"):
            authoring["error"] = model["error"]
json.dump({"ok": True, "pages": pages, "authoring": authoring}, sys.stdout)

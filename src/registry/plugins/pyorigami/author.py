"""IPC entry point; authoring.py is prepended by the desktop transport."""
import json
import sys

request = json.load(sys.stdin)
try:
    contents = author_source(request["contents"], request["operation"])
    json.dump({"ok": True, "contents": contents}, sys.stdout)
except (ValueError, SyntaxError, cst.ParserSyntaxError) as error:
    json.dump({"ok": False, "error": str(error)}, sys.stdout)

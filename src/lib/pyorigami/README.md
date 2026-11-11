# pyOrigami prototype

This extension follows the editor/executor architecture on `codex/editor-dialogs`.
It shares the image canvas from `codex/png-viewing` with the PNG view.
It is behind the existing project-shell feature flag and the default-off
**pyOrigami** plugin setting.

## Try it

1. Install Ghostscript (`brew install ghostscript` on macOS).
2. From the repository root, run `bash scripts/setup-pyorigami.sh`. This installs
   the pinned upstream Python package into the ignored `venv/pyorigami` directory.
   The script skips its optional C++ extension; rendering uses the pure-Python backend.
   It also installs LibCST for source-preserving authoring. Rerun setup when updating
   an environment created before authoring support was added.
3. Start the desktop app with the Python environment selected:

   ```sh
   ZDS_PYORIGAMI_PYTHON="$PWD/venv/pyorigami/bin/python" npm run tron:start
   ```

4. With the project-shell feature enabled, enable **pyOrigami** in Plugins.
5. Open `src/lib/pyorigami/example.origami.py` in the Editors pane and select
   **Origami** in its view picker. Switch to **Code** to edit it; the preview
   rerenders from the current buffer. Drag to pan, scroll/pinch to zoom, or use
   **Fit image**. Multi-page diagrams have a page selector.

Ordinary `.py` files are unaffected. `.origami.py` filenames select this format;
callers may instead create an unnamed editor with
`{ documentType: PYORIGAMI_DOCUMENT }`, imported from `document.ts`.
Programs must assign a `pyorigami.Diagram` to `diagram`; they do not need to call
`render()` or choose an output file. The sample contains two illustrated steps
with fold-and-unfold arrows.

## Runtime contract

The executor sends a source snapshot to Electron through the existing plugin IPC
bridge. Python runs with local user permissions in a disposable working directory.
Only use trusted programs: this is ordinary Python execution, not a sandbox.
The desktop environment must have Python, pyOrigami, PyMuPDF, and Ghostscript
available. Browser rendering is not provided by this prototype and reports a
desktop-runtime error.

Each run owns its process and output directory. Edits or view disposal cancel the
previous run. Runs have a 30-second deadline and a 16 MB combined output limit;
the executor framework prevents cancelled results replacing newer results.
On macOS/Linux cancellation terminates the process group, including Ghostscript.
Windows terminates the Python process; process-tree cancellation is not yet implemented there.
Python tracebacks are shown in the preview. Printed text is redirected away from
the JSON result stream. All PDF pages are converted to separate SVGs because
upstream's direct SVG exporter only exports the first page. SVGs are displayed as
image blobs, so their contents are not inserted into the application's DOM.

## Author in the output

Click the rendered title, designer or diagrammer credit, or a step caption to
activate its editing box. Tab also activates these fields, including missing
values. Empty captions and paper-color fields have subtle placeholders. Enter
or leaving the field commits it; Escape discards the draft. Paper colors accept
a name such as `red` or three RGB percentages such as `100, 80, 20`.

Use **+ Add step** at the bottom of the last page to append a step. It inherits
existing geometry and creases from the preceding step. Adding the first step to
an empty diagram also creates a square sheet of paper. Each existing caption is
editable; a step without captions has a focusable **Add caption** region.

Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, and Cmd/Ctrl+Y operate on the shared document in
Origami mode. Each operation, including any imports it needs, is one undo entry.
Undo/Redo discards an uncommitted field draft and cancels pending authoring edits.
The camera stays in place while updated SVG output arrives.

## Authoring contract

`authoring.py` is the shared LibCST service. Its `inspect_authoring` and
`author_source` entry points parse source without executing it. The registry's
`pyorigamiAuthoringService` sends operations through Electron, rejects replies
for changed or closed documents, and applies the result in an isolated history
transaction. Existing module/class aliases are reused when unambiguous; new
imports avoid collisions. Comments and unrelated formatting are retained.

The initial editable subset is a direct top-level `diagram = Diagram(...)`, a
direct `DiagramHeader(...)`, and direct `Step(...)` declarations with literal
body lists. Positional and keyword constructor arguments are supported. Computed
field expressions are read-only; computed body lists, command factories,
functions, and programs that use or mutate `diagram` after construction remain
renderable but require Code mode for editing. No general Python refactoring or
LSP server is introduced by this prototype.

The renderer returns normalized page hit regions. Invisible PDF links carry
caption ownership through Doodle's actual layout, including multiple pages;
header regions use PDF text bounds. The pinned writer's step hook supplies
caption anchors even when the caption is absent. The image canvas keeps these
DOM controls mounted as the SVG changes so focused drafts survive execution.
Queued property/caption edits and append-only step additions may follow one
another; edits from Code or another view never silently rebase an in-flight edit.

Run the pure source-transform suite with:

```sh
venv/pyorigami/bin/python -m unittest discover -s src/lib/pyorigami -p test_authoring.py
```

The opt-in `render.spec.ts` suite exercises the real Python renderer and authoring
transport when `ZDS_PYORIGAMI_PYTHON` names the installed environment.

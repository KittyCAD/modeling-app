# Project settings editor

The Settings view presents an existing `project.toml` as a form in the experimental
project shell. It shares its document, undo history, and save pipeline with Code.
Other TOML files continue to use Code; no preview-only TOML mode is registered.

Sections and fields come from the document, including plugin fields unknown to the
application. Editing an existing string, number, or boolean replaces only that
literal in the current source, preserving comments and unrelated formatting.
Nested tables and arrays are displayed recursively. Dates are displayed without
form editing; use Code to add or remove fields or change the document structure.
Malformed TOML displays its parse error instead of editable stale fields, and
read-only documents disable form controls.

The registry contributes the view, a TOML parsing capability, and a save step for
project metadata. Only the active opening's root `project.toml` can update its
title and default file; saving a nested file does not change that opening's
metadata. These contributions require `zds_project_shell_refactor` and have no KCL,
scene, or Modeling view dependencies.

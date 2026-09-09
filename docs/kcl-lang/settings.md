---
title: "Settings"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

# KCL Settings

There are three levels of settings available in Zoo Design Studio:

1. [User Settings](/docs/kcl-lang/settings/user): Global settings that apply to all projects, stored in `user.toml`
2. [Project Settings](/docs/kcl-lang/settings/project): Settings specific to a project, stored in `project.toml`
3. Per-file Settings: Settings that apply to a single KCL file, specified using the `@settings` attribute

## Configuration Files

Zoo Design Studio uses TOML files for configuration:

* **User Settings**: `user.toml` - See [complete documentation](/docs/kcl-lang/settings/user)
* **Project Settings**: `project.toml` - See [complete documentation](/docs/kcl-lang/settings/project)

## Per-file settings

Settings which affect a single file are configured using the settings attribute.
This must be at the top of the KCL file (comments before the attribute are permitted).
For example:

```kcl
// The settings attribute.
@settings(kclVersion = 2.0, defaultLengthUnit = in)

// The rest of your KCL code goes below...

x = 42 // Represents 42 inches.
```

The settings attribute may contain multiple properties separated by commas.
Valid properties are:

- `defaultLengthUnit`: the default length unit to use for numbers declared in this file.
  - Accepted values: `mm`, `cm`, `m`, `in` (inches), `ft` (feet), `yd` (yards).
- `defaultAngleUnit`: the default angle unit to use for numbers declared in this file.
  - Accepted values: `deg` (degrees), `rad` (radians).
  - Deprecated with a warning in KCL 2.0 and earlier, and an error in KCL 3.0-preview and later. Use explicit suffixes for angles, e.g. `180deg` or `3.14rad`, instead.
- `experimentalFeatures`: how experimental features are handled within this file.
  - Accepted values: `allow` (experimental features can be used freely), `warn` (experimental features
  cause a warning), `deny` (the default, experimental features cause an error).
- `kclVersion`: the version of the KCL language and standard libary to execute with.
  - Accepted values: `1.0`, `2.0`, `"3.0-preview"` (experimental).
  - When the file being executed declares `"3.0-preview"`, that version governs the whole
    execution, including any files it imports. Under `"3.0-preview"`:
    - `return` immediately exits the enclosing function; statements after an executed
      `return` do not run.
    - Each `if`/`else if`/`else` branch body introduces its own scope: a variable declared
      inside a branch is visible from its declaration to the branch's closing brace, never
      outside it, and may shadow a variable from an enclosing scope.
    - A member expression evaluates its object before its property: in `a[b]`, `a` is
      evaluated before `b`. Earlier versions evaluate `b` first.
    - `fillet` and `chamfer` are sent to the engine immediately, in order with other
      modeling commands, instead of being deferred until the end of the file. The engine
      replaces a cut edge with a new face, so look up an edge (for example with
      `getOppositeEdge` or `getNextAdjacentEdge`) before the `fillet` or `chamfer` that
      consumes it, and store the result in a variable.

These settings override any project-wide settings (configured in project.toml or via the UI).

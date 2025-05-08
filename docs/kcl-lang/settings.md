---
title: "Settings"
excerpt: "Documentation of settings for the KCL language and Zoo Design Studio."
layout: manual
---

# KCL Settings

There are three levels of settings available in Zoo Design Studio:

1. [User Settings](/docs/kcl/settings/user): Global settings that apply to all projects, stored in `user.toml`
2. [Project Settings](/docs/kcl/settings/project): Settings specific to a project, stored in `project.toml`
3. Per-file Settings: Settings that apply to a single KCL file, specified using the `@settings` attribute

## Configuration Files

Zoo Design Studio uses TOML files for configuration:

* **User Settings**: `user.toml` - See [complete documentation](/docs/kcl/settings/user)
* **Project Settings**: `project.toml` - See [complete documentation](/docs/kcl/settings/project)

## Per-file settings

Settings which affect a single file are configured using the settings attribute.
This must be at the top of the KCL file (comments before the attribute are permitted).
For example:

```kcl
// The settings attribute.
@settings(defaultLengthUnit = in)

// The rest of your KCL code goes below...

x = 42 // Represents 42 inches.
```

The settings attribute may contain multiple properties separated by commas.
Valid properties are:

- `defaultLengthUnit`: the default length unit to use for numbers declared in this file.
  - Accepted values: `mm`, `cm`, `m`, `in` (inches), `ft` (feet), `yd` (yards).
- `defaultAngleUnit`: the default angle unit to use for numbers declared in this file.
  - Accepted values: `deg` (degrees), `rad` (radians).

These settings override any project-wide settings (configured in project.toml or via the UI).

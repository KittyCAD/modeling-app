---
title: "KCL settings"
excerpt: "Documentation of settings for the KCL language and Zoo Modeling App."
layout: manual
---

# Per-file settings

Settings which affect a single file are configured using the settings attribute.
This must be at the top of the KCL file (comments before the attribute are permitted).
E.g.,

```
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

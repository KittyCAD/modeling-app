---
title: "Attributes"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

Attributes are syntax which affects the language item they annotate. In KCL they are indicated using `@`. For example, `@settings` affects the file in which it appears.

There are two kinds of attributes: named and unnamed attributes. Named attributes (e.g., `@settings`) have a name immediately after the `@` (e.g., `settings`) and affect their surrounding scope. Unnamed attributes have no name and affect the following item, e.g.,

```kcl,norun
@(lengthUnit = ft, coords = opengl)
import "tests/inputs/cube.obj"
```

has an unnamed attribute on the `import` statement.

Named and unnamed attributes may take a parenthesized list of arguments (like a function). Named attributes may also appear without any arguments (e.g., `@no_std`).

## Named attributes

The `@settings` attribute affects the current file and accepts the following arguments: `defaultLengthUnit`, `defaultAngleUnit`, and `kclVersion`. See [settings](/docs/kcl-lang/settings) for details.

The `@no_std` attribute affects the current file, takes no arguments, and causes the standard library to not be implicitly available. It can still be used by being explicitly imported.

## Unnamed attributes

Unnamed attributes may be used on `import` statements when importing non-KCL files. See [projects, modules, and imports](/docs/kcl-lang/modules) for details.

Other unnamed attributes are used on functions inside the standard library, but these are not available in user code.

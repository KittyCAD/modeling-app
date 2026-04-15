---
title: "startProfile"
subtitle: "Function in std::sketch"
excerpt: "Start a new profile at a given point."
layout: manual
---

Start a new profile at a given point.

```kcl
startProfile(
  @startProfileOn: Plane | Face,
  at: Point2d,
  tag?: TagDecl,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `startProfileOn` | [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | What to start the profile on. | Yes |
| `at` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where to start the profile. An absolute point. | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Tag this first starting point. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.




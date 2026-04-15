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
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `startProfileOn` | `Plane | Face` | What to start the profile on. | Yes |
| `at` | `Point2d` | Where to start the profile. An absolute point. | Yes |
| `tag` | `TagDecl` | Tag this first starting point. | No |

### Returns

`Sketch` - A sketch is a collection of paths.




---
title: "gdt::LeaderType"
subtitle: "Type in std::gdt"
excerpt: "The endpoint marker for an attached GD&T annotation."
layout: manual
---

The endpoint marker for an attached GD&T annotation.

```kcl
type LeaderType {
  | None
  | Dot
  | Arrow
}
```

When leaderType is omitted, face attachments use dots and edge attachments
use arrows, including annotations created by point and click.
Set `leaderType = gdt::LeaderType::Arrow` to override the automatic marker.
Explicit enum values require `@settings(experimentalFeatures = allow)`.


### Variants

| Variant | Description |
|---------|-------------|
| `None` | Keep the leader line without an endpoint marker. |
| `Dot` | A dot at the attachment point. |
| `Arrow` | An arrowhead at the attachment point. |



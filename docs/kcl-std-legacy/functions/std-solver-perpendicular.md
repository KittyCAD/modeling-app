---
title: "solver::perpendicular"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to be perpendicular."
layout: manual
---

Constrain lines to be perpendicular.

```kcl
solver::perpendicular(@input: [Segment; 2+])
```

Currently limited to two lines.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2+]` | The line segments that should remain perpendicular. Currently limited to two lines. | Yes |




---
title: "solver::fixed"
subtitle: "Constant in std::solver"
excerpt: "Constrain a point to be fixed to a position."
layout: manual
---

Constrain a point to be fixed to a position.

```kcl
solver::fixed
```

`fixed()` is an alias for `coincident()`. By convention, `fixed()` is used when one of the points is a known location, not solved with constraints and not another point in the sketch.

See [coincident()](/docs/kcl-std/functions/std-sketch2-coincident) for more info.



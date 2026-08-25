---
title: "SketchBlock"
subtitle: "Type in std::types"
excerpt: "The result of a KCL 2 sketch block."
layout: manual
---

The result of a KCL 2 sketch block.

```kcl
type SketchBlock = { meta: { sketch: Sketch } }
```

A sketch block result contains the underlying sketch geometry together with
the block-local members declared while constructing it. Functions that
preserve this type also preserve access to those members.




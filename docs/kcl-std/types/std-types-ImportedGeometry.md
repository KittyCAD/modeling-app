---
title: "ImportedGeometry"
subtitle: "Type in std::types"
excerpt: "Represents geometry which is defined using some other CAD system and imported into KCL."
layout: manual
---

Represents geometry which is defined using some other CAD system and imported into KCL.

[`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) is distinct from [`Solid`](/docs/kcl-std/types/std-types-Solid), and there is no conversion between them. An import
can be positioned and styled, but not modelled against.

Accepted by: `clone`, `translate`, `rotate`, `scale`, `appearance`, `hide`, `delete`.

Rejected by every operation typed to take a [`Solid`](/docs/kcl-std/types/std-types-Solid), including `subtract`, `union`, `intersect`,
`fillet`, `chamfer`, `shell`, the pattern functions, and `startSketchOn`. This applies to BREP
formats such as STEP and mesh formats such as STL alike. To modify imported geometry, recreate
the shape natively in KCL, or leave the import as a reference and build a separate part around
it.




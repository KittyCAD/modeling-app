---
title: "Known Issues"
excerpt: "Known issues with the KCL standard library for the Zoo Design Studio."
layout: manual
---

## Geometry Engine

The following are bugs that are not in Zoo Design Studio or KCL itself. These bugs,
once fixed in engine, will just start working here with no language changes.

- **Import**: Right now you can import a file, but even if that file has BREP data
    you cannot yet edit it, the engine will account for this later. 

- **CSG Booleans**: Coplanar (bodies that share a plane) unions, subtractions, and intersections are not currently supported.

## KCL Version 1.0

The following are known issues with KCL 1.0. To opt-in to the fixes and new features, use the latest version of KCL with `@settings(kclVersion = 2.0)`.

- **Region tags are shuffled**: When you name a segment in a sketch block, the tags in the region may not correspond to the original sketch segments. This is fixed in KCL 2.0.

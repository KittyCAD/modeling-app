---
title: "Known Issues"
excerpt: "Known issues with the KCL standard library for the Zoo Design Studio."
layout: manual
---

The following are bugs that are not in Zoo Design Studio or KCL itself. These bugs,
once fixed in engine, will just start working here with no language changes.

- **Import**: Right now you can import a file, but even if that file has BREP data
    you cannot yet edit it, the engine will account for this later. 

- **CSG Booleans**: Coplanar (bodies that share a plane) unions, subtractions, and intersections are not currently supported.

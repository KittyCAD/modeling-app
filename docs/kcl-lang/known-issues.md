---
title: "Known Issues"
excerpt: "Known issues with the KCL standard library for the Zoo Design Studio."
layout: manual
---

The following are bugs that are not in Zoo Design Studio or KCL itself. These bugs,
once fixed in engine, will just start working here with no language changes.

- **Sketch on Face**: If your sketch is outside the edges of the face (on which you
    are sketching) you will get multiple models returned instead of one single
    model for that sketch and its underlying 3D object.
    If you see a red line around your model, it means this is happening.

- **Import**: Right now you can import a file, but even if that file has BREP data
    you cannot yet edit it, the engine will account for this later. 

- **CSG Booleans**: Coplanar (bodies that share a plane) unions, subtractions, and intersections are not currently supported.

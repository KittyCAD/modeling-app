---
title: "TaggedEdge"
subtitle: "Type in std::types"
excerpt: "A tag which references a line, arc, or other edge in a sketch or an edge of a solid."
layout: manual
---

A tag which references a line, arc, or other edge in a sketch or an edge of a solid.

Created by using a tag declarator (see the docs for `TagDecl`). Can be used where an `Edge` is
required.

If a line in a sketch is tagged and then the sketch is extruded, the tag is a `TaggedEdge` before
extrusion and a `TaggedFace` after extrusion.




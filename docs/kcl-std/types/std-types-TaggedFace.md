---
title: "TaggedFace"
subtitle: "Type in std::types"
excerpt: "A tag which references a face of a solid, including the distinguished tags `START` and `END`."
layout: manual
---

A tag which references a face of a solid, including the distinguished tags `START` and `END`.

Created by using a tag declarator (see the docs for [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl)).

If a line in a sketch is tagged and then the sketch is extruded, the tag is a [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) before
extrusion and a [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) after extrusion.




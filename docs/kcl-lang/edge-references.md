---
title: "Face API Edge References"
excerpt: "Identifying edges by their surrounding faces in KCL."
layout: manual
---

The face API identifies an edge from the faces around it instead of relying on
the edge's position in a body's internal ordering. This makes references more
stable when earlier modeling operations change the body's topology.

For most solid edges, the two adjacent faces uniquely identify the edge. Put
those faces in `sideFaces`:

```kcl,norun
fillet(
  body001,
  radius = 2,
  edges = [{
    sideFaces = [region001.tags.bottom, endCap]
  }],
)
```

The faces in `sideFaces` run along the length of the edge. An operation can
split an edge into multiple edges that still have the same side faces. To select
one split, add an `endFaces` entry for a face touching the end of the intended
edge:

```kcl,norun
{
  sideFaces = [region001.tags.bottom, region001.tags.right],
  endFaces = [startCap]
}
```

Some solid-modeling topology can leave multiple edges with the same side and
end faces. In that case, `index` selects one of the remaining matches using a
zero-based index:

```kcl,norun
{
  sideFaces = [region001.tags.bottom, endCap],
  index = 1
}
```

Prefer `sideFaces` alone when it is unambiguous. Add `endFaces` when an edge has
been split, and use `index` only when the face information still leaves more
than one match. When a Face API selection supplies an edge-reference object,
keep the fields it provides rather than converting the selection to legacy
edge helpers.

Surface bodies do not always provide two side faces or useful end faces. Their
edge references can therefore contain a single `sideFaces` entry and rely on
`index` more often to choose a boundary edge.

The same edge-reference object can be used by operations such as `fillet`,
`chamfer`, `revolve`, `helix`, and `mirror3d` where their parameter accepts an
edge.

Sketch segments remain direct references, such as `sketch001.line1`. Edge
reference objects are for edges on generated bodies, where adjacent face tags
provide a stable description of the intended geometry.

## Edges involving generated faces

Fillets and chamfers create new faces that can form part of edges used by later
operations. Add `tag` to the edge-treatment operation to name its generated
face, then use that tag in the later edge reference. The existing operation
produces the face and should remain in the model; selecting one of its generated
faces does not mean replacing the operation itself.

For example, this fillet targets the edge shared by the existing chamfer face
and the extrusion's end cap:

```kcl,norun
chamfer001 = chamfer(
  body001,
  edges = [{
    sideFaces = [region001.tags.right, region001.tags.bottom]
  }],
  length = 4,
  tag = $chamferFace,
)

fillet001 = fillet(
  body001,
  edges = [{
    sideFaces = [chamferFace, endCap]
  }],
  radius = 2,
)
```

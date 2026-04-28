---
title: "patternTransform"
subtitle: "Function in std::solid"
excerpt: "Repeat a 3-dimensional solid, changing it each time."
layout: manual
---

Repeat a 3-dimensional solid, changing it each time.

```kcl
patternTransform(
  @solids: [Solid; 1+],
  instances: number(_),
  transform: fn(number(_)): { },
  useOriginal?: bool,
): [Solid; 1+]
```

Replicates the 3D solid, applying a transformation function to each replica.
Transformation function could alter rotation, scale, visibility, position, etc.

The `patternTransform` call itself takes a number for how many total instances of
the shape should be. For example, if you use a circle with `patternTransform(instances = 4, transform = f)`
then there will be 4 circles: the original, and 3 created by replicating the original and
calling the transform function on each.

The transform function takes a single parameter: an integer representing which
number replication the transform is for. E.g. the first replica to be transformed
will be passed the argument `1`. This simplifies your math: the transform function can
rely on id `0` being the original instance passed into the `patternTransform`. See the examples.

The transform function returns a transform object. All properties of the object are optional,
they each default to "no change". So the overall transform object defaults to "no change" too.
Its properties are:

 - `translate` (3D point)

   Translates the replica, moving its position in space.

 - `replicate` (bool)

   If false, this ID will not actually copy the object. It'll be skipped.

 - `scale` (3D point)

   Stretches the object, multiplying its width in the given dimension by the point's component in
   that direction.

 - `rotation` (object, with the following properties)

   - `rotation.axis` (a 3D point, defaults to the Z axis)

   - `rotation.angle`

   - `rotation.origin` (either "local" i.e. rotate around its own center, "global" i.e. rotate around the scene's center, or a 3D point, defaults to "local")

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | `[Solid; 1+]` | The solid(s) to duplicate. | Yes |
| `instances` | `number(_)` | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `transform` | `fn(number(_)): { }` | How each replica should be transformed. The transform function takes a single parameter: an integer representing which number replication the transform is for. E.g. the first replica to be transformed will be passed the argument `1`. This simplifies your math: the transform function can rely on id `0` being the original instance passed into the `patternTransform`. See the examples. | Yes |
| `useOriginal` | `bool` | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

`[Solid; 1+]`




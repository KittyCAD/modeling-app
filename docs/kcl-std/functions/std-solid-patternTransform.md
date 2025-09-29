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
| `solids` | [`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) | The solid(s) to duplicate. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `transform` | [`fn(number(_)): { }`](/docs/kcl-std/types/std-types-fn) | How each replica should be transformed. The transform function takes a single parameter: an integer representing which number replication the transform is for. E.g. the first replica to be transformed will be passed the argument `1`. This simplifies your math: the transform function can rely on id `0` being the original instance passed into the `patternTransform`. See the examples. | Yes |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid)


### Examples

```kcl
// Each instance will be shifted along the X axis.
fn transform(@id) {
  return { translate = [4 * id, 0, 0] }
}

// Sketch 4 cylinders.
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 5)
  |> patternTransform(instances = 4, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Each instance will be shifted along the X axis,
// with a gap between the original (at x = 0) and the first replica
// (at x = 8). This is because `id` starts at 1.
fn transform(@id) {
  return { translate = [4 * (1 + id), 0, 0] }
}

sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 5)
  |> patternTransform(instances = 4, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
fn cube(length, center) {
  l = length / 2
  x = center[0]
  y = center[1]
  p0 = [-l + x, -l + y]
  p1 = [-l + x, l + y]
  p2 = [l + x, l + y]
  p3 = [l + x, -l + y]

  return startSketchOn(XY)
    |> startProfile(at = p0)
    |> line(endAbsolute = p1)
    |> line(endAbsolute = p2)
    |> line(endAbsolute = p3)
    |> line(endAbsolute = p0)
    |> close()
    |> extrude(length = length)
}

width = 20
fn transform(@i) {
  return {
    // Move down each time.
    translate = [0, 0, -i * width],
    // Make the cube longer, wider and flatter each time.
    scale = [
      pow(1.1, exp = i),
      pow(1.1, exp = i),
      pow(0.9, exp = i)
    ],
    // Turn by 15 degrees each time.
    rotation = { angle = 15deg * i, origin = "local" }
  }
}

myCubes = cube(length = width, center = [100, 0])
  |> patternTransform(instances = 25, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
fn cube(length, center) {
  l = length / 2
  x = center[0]
  y = center[1]
  p0 = [-l + x, -l + y]
  p1 = [-l + x, l + y]
  p2 = [l + x, l + y]
  p3 = [l + x, -l + y]

  return startSketchOn(XY)
    |> startProfile(at = p0)
    |> line(endAbsolute = p1)
    |> line(endAbsolute = p2)
    |> line(endAbsolute = p3)
    |> line(endAbsolute = p0)
    |> close()
    |> extrude(length = length)
}

width = 20
fn transform(@i) {
  return {
    translate = [0, 0, -i * width],
    rotation = {
      angle = 90deg * i,
      // Rotate around the overall scene's origin.
      origin = "global"
    }
  }
}
myCubes = cube(length = width, center = [100, 100])
  |> patternTransform(instances = 4, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Parameters
r = 50 // base radius
h = 10 // layer height
t = 0.005 // taper factor [0-1)
// Defines how to modify each layer of the vase.
// Each replica is shifted up the Z axis, and has a smoothly-varying radius
fn transform(@replicaId) {
  scale = r * abs(1 - (t * replicaId)) * (5 + cos((replicaId / 8): number(rad)))
  return {
    translate = [0, 0, replicaId * 10],
    scale = [scale, scale, 0]
  }
}
// Each layer is just a pretty thin cylinder.
fn layer() {
  return startSketchOn(XY)
    // or some other plane idk
    |> circle(center = [0, 0], radius = 1, tag = $tag1)
    |> extrude(length = h)
}
// The vase is 100 layers tall.
// The 100 layers are replica of each other, with a slight transformation applied to each.
vase = layer()
  |> patternTransform(instances = 100, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
fn transform(@i) {
  // Transform functions can return multiple transforms. They'll be applied in order.
  return [
    { translate = [30 * i, 0, 0] },
    { rotation = { angle = 45deg * i } }
  ]
}
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> polygon(
       radius = 10,
       numSides = 4,
       center = [0, 0],
       inscribed = false,
     )
  |> extrude(length = 4)
  |> patternTransform(instances = 3, transform = transform)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternTransform function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternTransform5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternTransform5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



---
title: "clone"
subtitle: "Function in std"
excerpt: "Clone a sketch or solid."
layout: manual
---

Clone a sketch or solid.

```kcl
clone(@geometries: [Sketch | Solid | ImportedGeometry; 1+]): [Sketch | Solid | ImportedGeometry; 1+]
```

This works essentially like a copy-paste operation. It creates a perfect replica
at that point in time that you can manipulate individually afterwards.

This doesn't really have much utility unless you need the equivalent of a double
instance pattern with zero transformations.

Really only use this function if YOU ARE SURE you need it. In most cases you
do not need clone and using a pattern with `instance = 2` is more appropriate.












// Clone an array that includes an imported geometry, solid and sketch.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `geometries` | `[Sketch | Solid | ImportedGeometry; 1+]` | The sketch, solid, or imported geometry to be cloned. | Yes |

### Returns

`[Sketch | Solid | ImportedGeometry; 1+]`


### Examples

```kcl
// Clone an imported model.

import "tests/inputs/cube.sldprt" as cube

myCube = cube

clonedCube = clone(myCube)
  |> translate(x = 1020)
  |> appearance(color = "#ff0000", metalness = 50, roughness = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



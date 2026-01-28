---
title: "hide"
subtitle: "Function in std::transform"
excerpt: "Hide solids, sketches, or imported objects."
layout: manual
---

Hide solids, sketches, or imported objects.

```kcl
hide(@objects: [Solid; 1+] | [Helix; 1+] | ImportedGeometry): [Solid; 1+] | [Helix; 1+] | ImportedGeometry
```

Hidden objects remain in the model and can still be referenced by later operations.
Hiding can be useful to see hard-to-reach vantages, or clarify overlapping geometry
while you work.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The solid, sketch, or set of solids or sketches to hide. | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [[`Helix`](/docs/kcl-std/types/std-types-Helix); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Hide a body, leaving a sketch on face intact
cylinder = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2mm)
dot = startSketchOn(cylinder, face = END)
  |> circle(center = [0, 0], radius = 1)
hide(cylinder)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hide function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-hide0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-hide0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Hide an imported model, leaving a local sketch.
import "tests/inputs/cube.sldprt" as cube

dot = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
cube
  |> hide()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hide function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-hide1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-hide1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Hide a helix, leave its cylinder
cylinder = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2mm)
helix001 = helix(revolutions = 16, angleStart = 0, cylinder)
hide(helix001)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hide function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-hide2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-hide2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



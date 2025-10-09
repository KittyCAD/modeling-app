---
title: "gdt::flatness"
subtitle: "Function in std::gdt"
excerpt: "GD&T annotation specifying how flat faces should be."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

GD&T annotation specifying how flat faces should be.

```kcl
gdt::flatness(
  faces: [TaggedFace; 1+],
  tolerance: number(Length),
  precision?: number(_),
  framePosition?: Point2d,
  framePlane?: Plane,
  fontPointSize?: number(_),
  fontScale?: number(_),
): [GdtAnnotation; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | [`[TaggedFace; 1+]`](/docs/kcl-std/types/std-types-TaggedFace) | The faces to be annotated. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from a perfect plane that is acceptable. | Yes |
| `precision` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of decimal places to display. The default is `3`. Must be greater than or equal to `0`. | No |
| `framePosition` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The position of the feature control frame relative to the leader arrow. The default is `[100mm, 100mm]`. | No |
| `framePlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the feature control frame. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The frame may be displayed in a plane parallel to the given plane. | No |
| `fontPointSize` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The font point size to use for the annotation text rendering. The default is `36`. | No |
| `fontScale` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Scale to use for the annotation text after rendering with the point size. The default is `1.0`. Must be greater than `0`. | No |

### Returns

[`[GdtAnnotation; 1+]`](/docs/kcl-std/types/std-types-GdtAnnotation)


### Examples

```kcl
@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagStart = $face1)
gdt::flatness(faces = [face1], tolerance = 0.1mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gdt::flatness function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gdt-flatness0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gdt-flatness0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5, tagEnd = $face1)
gdt::flatness(
  faces = [face1],
  tolerance = 0.02mm,
  framePosition = [10mm, 20mm],
  framePlane = XZ,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gdt::flatness function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gdt-flatness1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gdt-flatness1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0], tag = $face1)
  |> line(end = [0, -10])
  |> close()
  |> extrude(length = 5)
gdt::flatness(
  faces = [face1],
  tolerance = 0.02mm,
  framePosition = [10mm, 20mm],
  framePlane = XZ,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gdt::flatness function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gdt-flatness2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gdt-flatness2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



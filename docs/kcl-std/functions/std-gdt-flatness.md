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
  offset?: Point2d,
  inPlane?: Plane,
  style?: AnnotationStyle,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | [`[TaggedFace; 1+]`](/docs/kcl-std/types/std-types-TaggedFace) | The faces to be annotated. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The amount of deviation from a perfect plane that is acceptable. | Yes |
| `offset` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The offset of the annotation from the centroid of the faces being annotated. The default is `[100mm, 100mm]`. | No |
| `inPlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane in which to display the annotation. The default is `XY`. Other standard planes like `XZ` and `YZ` can also be used. The annotation may be displayed in a plane parallel to the given plane. | No |
| `style` | [`AnnotationStyle`](/docs/kcl-std/types/std-types-AnnotationStyle) | How to display the annotation. | No |


### Examples

```kcl
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



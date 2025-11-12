---
title: "shell"
subtitle: "Function in std::solid"
excerpt: "Remove volume from a 3-dimensional shape such that a wall of the provided thickness remains, taking volume starting at the provided face, leaving it open in that direction."
layout: manual
---

Remove volume from a 3-dimensional shape such that a wall of the provided thickness remains, taking volume starting at the provided face, leaving it open in that direction.

```kcl
shell(
  @solids: [Solid; 1+],
  thickness: number(Length),
  faces: [TaggedFace; 1+],
): [Solid]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | Which solid (or solids) to shell out | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The thickness of the shell | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces you want removed | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid)]


### Examples

```kcl
// Remove the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the end face for the extrusion.
shell(firstSketch, faces = [END], thickness = 0.25)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Remove the start face for the extrusion.
firstSketch = startSketchOn(-XZ)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

// Remove the start face for the extrusion.
shell(firstSketch, faces = [START], thickness = 0.25)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Remove a tagged face and the end face for the extrusion.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0], tag = $myTag)
  |> close()
  |> extrude(length = 6)

// Remove a tagged face for the extrusion.
shell(firstSketch, faces = [myTag], thickness = 0.25)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Remove multiple faces at once.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0], tag = $myTag)
  |> close()
  |> extrude(length = 6)

// Remove a tagged face and the end face for the extrusion.
shell(firstSketch, faces = [myTag, END], thickness = 0.25)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Shell a sketch on face.
size = 100
case = startSketchOn(-XZ)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

// We put "case" in the shell function to shell the entire object.
shell(case, faces = [START], thickness = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Shell a sketch on face object on the end face.
size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

// We put "thing1" in the shell function to shell the end face of the object.
shell(thing1, faces = [END], thickness = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Shell sketched on face objects on the end face, include all sketches to shell
// the entire object.


size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

// We put "thing1" and "thing2" in the shell function to shell the end face of the object.
shell([thing1, thing2], faces = [END], thickness = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



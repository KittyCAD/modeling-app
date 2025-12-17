---
title: "subtract"
subtitle: "Function in std::solid"
excerpt: "Subtract removes tool solids from base solids, leaving the remaining material."
layout: manual
---

Subtract removes tool solids from base solids, leaving the remaining material.

```kcl
subtract(
  @solids: [Solid; 1+],
  tools: [Solid],
  tolerance?: number(Length),
): [Solid; 1+]
```

Performs a bool subtraction operation, removing the volume of one or more
tool solids from one or more base solids. The result is a new solid
representing the material that remains after all tool solids have been cut
away. This function is essential for machining simulations, cavity creation,
and complex multi-body part modeling.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The solids to use as the base to subtract from. | Yes |
| `tools` | [[`Solid`](/docs/kcl-std/types/std-types-Solid)] | The solids to subtract. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// Subtract a cylinder from a cube using the stdlib functions.

fn cube(center, size) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] + size])
    |> line(endAbsolute = [center[0] - size, center[1] + size])
    |> close()
    |> extrude(length = 10)
}

part001 = cube(center = [0, 0], size = 10)
part002 = cube(center = [7, 3], size = 5)
  |> translate(z = 1)

subtractedPart = subtract([part001], tools = [part002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Subtract a cylinder from a cube using operators.
// NOTE: This will not work when using codemods through the UI.
// Codemods will generate the stdlib function call instead.

fn cube(center, size) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] + size])
    |> line(endAbsolute = [center[0] - size, center[1] + size])
    |> close()
    |> extrude(length = 10)
}

part001 = cube(center = [0, 0], size = 10)
part002 = cube(center = [7, 3], size = 5)
  |> translate(z = 1)

// This is the equivalent of: subtract([part001], tools=[part002])
subtractedPart = part001 - part002

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(defaultLengthUnit = in)

height = 2.5
width = 2.5
bodyLength = 6
mountCenterToCenter = 1.625
rodThreadLength = 0.75
strokeLength = 1
boreDiameter = 1.5
rodDiameter = 0.625
portCenterToCenter = 3.875
rodThreadSize = 0.438

// Sketch a cube.
sketch001 = startSketchOn(YZ)
profile001 = startProfile(sketch001, at = [-width / 2, -height / 2])
  |> angledLine(angle = 0deg, length = width, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = height, tag = $seg01)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
blueCube = extrude(profile001, length = -1.5)
appearance(blueCube, color = '#9dcfed')

// Sketch a cylinder.
sketch002 = startSketchOn(blueCube, face = START)
profile002 = circle(sketch002, center = [0, 0], radius = boreDiameter / 2)
profile003 = circle(sketch002, center = [0, 0], radius = boreDiameter / 2 + 0.1)
  |> subtract2d(tool = profile002)
cylinder = extrude(profile003, length = 2.375, method = NEW)
appearance(cylinder, color = '#9dcfed')

// Sketch a second cube.
sketch003 = startSketchOn(cylinder, face = END)
profile004 = startProfile(sketch003, at = [-width / 2, -height / 2])
  |> angledLine(angle = 0deg, length = width, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) + 90deg, length = height)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
brownCube = extrude(profile004, length = 1.75)
  |> appearance(color = "#da7333", roughness = 50, metalness = 90)

// Sketch 4 circles.
sketch006 = startSketchOn(blueCube, face = END)
profile008 = circle(
  sketch006,
  center = [
    mountCenterToCenter / 2,
    mountCenterToCenter / 2
  ],
  diameter = 0.375,
)
profile009 = circle(
  sketch006,
  center = [
    -mountCenterToCenter / 2,
    mountCenterToCenter / 2
  ],
  diameter = 0.375,
)
profile010 = circle(
  sketch006,
  center = [
    -mountCenterToCenter / 2,
    -mountCenterToCenter / 2
  ],
  diameter = 0.375,
)
profile011 = circle(
  sketch006,
  center = [
    mountCenterToCenter / 2,
    -mountCenterToCenter / 2
  ],
  diameter = 0.375,
)

// Extrude the 4 circles into 4 rods.
rods = extrude(
       [
         profile008,
         profile009,
         profile010,
         profile011
       ],
       length = -6,
       method = NEW,
     )
  |> appearance(color = "#ff2222", roughness = 50, metalness = 90)

// Subtract all 4 rods from both cubes.
subtract([blueCube, brownCube], tools = rods)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



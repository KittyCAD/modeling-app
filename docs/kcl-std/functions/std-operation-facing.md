---
title: "operation::facing"
subtitle: "Function in std::operation"
excerpt: ""
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.



```kcl
operation::facing(
  @solid: Solid,
  toolDiameter: number(Length),
  stepOver: number,
): number(_)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | A solid is a collection of extruded surfaces. | Yes |
| `toolDiameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `stepOver` | [`number`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`number(_)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0, experimentalFeatures = allow)

stockLength = 100mm
stockWidth = 60mm
stockHeight = 20mm
toolDiameter = 20mm
stepOver = 0.7
halfStockLength = (stockLength / 2): mm
halfStockWidth = (stockWidth / 2): mm

stockProfile = sketch(on = XY) {
  bottomEdge = line(start = [var -50mm, var -30mm], end = [var 50mm, var -30mm])
  rightEdge = line(start = [var 50mm, var -30mm], end = [var 50mm, var 30mm])
  topEdge = line(start = [var 50mm, var 30mm], end = [var -50mm, var 30mm])
  leftEdge = line(start = [var -50mm, var 30mm], end = [var -50mm, var -30mm])

  coincident([bottomEdge.end, rightEdge.start])
  coincident([rightEdge.end, topEdge.start])
  coincident([topEdge.end, leftEdge.start])
  coincident([leftEdge.end, bottomEdge.start])
  horizontal(bottomEdge)
  vertical(rightEdge)
  horizontal(topEdge)
  vertical(leftEdge)
  horizontalDistance([bottomEdge.start, bottomEdge.end]) == stockLength
  verticalDistance([rightEdge.start, rightEdge.end]) == stockWidth
  horizontalDistance([bottomEdge.start, ORIGIN]) == halfStockLength
  verticalDistance([bottomEdge.start, ORIGIN]) == halfStockWidth
}

stockRegion = region(
  segments = [
    stockProfile.bottomEdge,
    stockProfile.rightEdge
  ],
  intersectionIndex = -1,
  direction = CCW,
)
stockBody = extrude(stockRegion, length = stockHeight)
hide(stockProfile)

facingOperation = operation::facing(stockBody, toolDiameter = toolDiameter, stepOver = stepOver)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the operation::facing function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-operation-facing0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-operation-facing0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



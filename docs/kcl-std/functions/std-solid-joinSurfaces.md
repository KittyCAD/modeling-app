---
title: "joinSurfaces"
subtitle: "Function in std::solid"
excerpt: "Join multiple surfaces together into one body, or join together the results of a split into one body"
layout: manual
---

Join multiple surfaces together into one body, or join together the results of a split into one body

```kcl
joinSurfaces(
  @selection: [Solid; 1+],
  tolerance?: number(Length),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `selection` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The bodies to join together | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
@settings(defaultLengthUnit = mm)

beamSectionWidth = 40
beamSectionHeight = 95
beamLength = 142
beamCurvedRadius = 2000
beamCurvedArcLength = beamLength
beamBoxCutterInset = 8
beamForkCutterGap = 2
beamForkCutterTipExtension = beamBoxCutterInset + beamForkCutterGap

beamHalfWidth = beamSectionWidth / 2
beamHalfHeight = beamSectionHeight / 2
beamCurvedAngle = -(beamCurvedArcLength / beamCurvedRadius): number(rad)
beamForkCutterHalfWidth = beamHalfWidth + beamForkCutterGap
beamForkCutterHalfHeight = beamHalfHeight + beamForkCutterGap
beamForkCutterBackX = beamForkCutterHalfWidth
beamForkCutterOpenX = -beamForkCutterHalfWidth - beamForkCutterTipExtension

beamForkCutterStraightProfile = startSketchOn(XZ)
  |> startProfile(at = [
       beamForkCutterOpenX,
       beamForkCutterHalfHeight
     ])
  |> line(
       end = [
         beamForkCutterBackX - beamForkCutterOpenX,
         0
       ],
       tag = $beamForkCutterTopStraightEdge,
     )
  |> line(end = [0, -2 * beamForkCutterHalfHeight], tag = $beamForkCutterBackStraightEdge)
  |> line(
       end = [
         beamForkCutterOpenX - beamForkCutterBackX,
         0
       ],
       tag = $beamForkCutterBottomStraightEdge,
     )

beamForkCutterStraight = extrude(beamForkCutterStraightProfile, length = beamLength, bodyType = SURFACE)

beamForkCutterCurvedProfile = startSketchOn(XZ)
  |> startProfile(at = [
       beamForkCutterOpenX,
       beamForkCutterHalfHeight
     ])
  |> line(
       end = [
         beamForkCutterBackX - beamForkCutterOpenX,
         0
       ],
       tag = $beamForkCutterTopCurvedEdge,
     )
  |> line(end = [0, -2 * beamForkCutterHalfHeight], tag = $beamForkCutterBackCurvedEdge)
  |> line(
       end = [
         beamForkCutterOpenX - beamForkCutterBackX,
         0
       ],
       tag = $beamForkCutterBottomCurvedEdge,
     )

curvedBeamAxis = {
  direction = [0, 1],
  origin = [beamCurvedRadius, 0]
}

beamForkCutterCurved = revolve(
  beamForkCutterCurvedProfile,
  axis = curvedBeamAxis,
  angle = beamCurvedAngle,
  bodyType = SURFACE,
)

beamForkCutterCurvedPlaced = beamForkCutterCurved
  |> rotate(axis = Z, angle = -22deg, global = true)
  |> translate(x = 93, y = 453, global = true)

beamForkCutterTopBlend = blend([
  getBoundedEdge(beamForkCutterCurvedPlaced, edge = getOppositeEdge(beamForkCutterTopCurvedEdge)),
  beamForkCutterTopStraightEdge
])

beamForkCutterBackBlend = blend([
  getBoundedEdge(beamForkCutterCurvedPlaced, edge = getOppositeEdge(beamForkCutterBackCurvedEdge)),
  beamForkCutterBackStraightEdge
])

beamForkCutterBottomBlend = blend([
  getBoundedEdge(beamForkCutterCurvedPlaced, edge = getOppositeEdge(beamForkCutterBottomCurvedEdge)),
  beamForkCutterBottomStraightEdge
])

bumperBeamForkCutter = [
       beamForkCutterTopBlend,
       beamForkCutterBackBlend,
       beamForkCutterBottomBlend
     ]
  |> joinSurfaces()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the joinSurfaces function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-joinSurfaces0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-joinSurfaces0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>



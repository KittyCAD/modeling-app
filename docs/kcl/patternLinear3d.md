---
title: "patternLinear3d"
excerpt: "A linear pattern on a 3D model."
layout: manual
---

A linear pattern on a 3D model.



```js
patternLinear3d(data: LinearPattern3dData, extrude_group: ExtrudeGroup) -> [ExtrudeGroup]
```

### Examples

```js
const part = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, 1], %)
  |> line([1, 0], %)
  |> line([0, -1], %)
  |> close(%)
  |> extrude(1, %)
  |> patternLinear3d({
       axis: [1, 0, 1],
       repetitions: 3,
       distance: 6
     }, %)
```

### Arguments

* `data`: `LinearPattern3dData` - Data for a linear pattern on a 3D model. (REQUIRED)
```js
{
	// The axis of the pattern.
	axis: [number, number, number],
	// The distance between each repetition. This can also be referred to as spacing.
	distance: number,
	// The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if `repetitions` is 1, the original entity will be copied once.
	repetitions: number,
}
```
* `extrude_group`: `ExtrudeGroup` - An extrude group is a collection of extrude surfaces. (REQUIRED)
```js
{
	// The id of the extrusion end cap
	endCapId: uuid,
	// The height of the extrude group.
	height: number,
	// The id of the extrude group.
	id: uuid,
	// The position of the extrude group.
	position: [number, number, number],
	// The rotation of the extrude group.
	rotation: [number, number, number, number],
	// The sketch group paths.
	sketchGroupValues: [{
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "ToPoint",
} |
{
	// arc's direction
	ccw: string,
	// the arc's center
	center: [number, number],
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "TangentialArcTo",
} |
{
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "TangentialArc",
} |
{
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "Horizontal",
	// The x coordinate.
	x: number,
} |
{
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "AngledLineTo",
	// The x coordinate.
	x: number,
	// The y coordinate.
	y: number,
} |
{
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
	type: "Base",
}],
	// The id of the extrusion start cap
	startCapId: uuid,
	// The extrude surfaces.
	value: [{
	// The face id for the extrude plane.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The name.
	name: string,
	// The position.
	position: [number, number, number],
	// The rotation.
	rotation: [number, number, number, number],
	// The source range.
	sourceRange: [number, number],
	type: "extrudePlane",
} |
{
	// The face id for the extrude plane.
	faceId: uuid,
	// The id of the geometry.
	id: uuid,
	// The name.
	name: string,
	// The position.
	position: [number, number, number],
	// The rotation.
	rotation: [number, number, number, number],
	// The source range.
	sourceRange: [number, number],
	type: "extrudeArc",
}],
	// The x-axis of the extrude group base plane in the 3D space
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// The y-axis of the extrude group base plane in the 3D space
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis of the extrude group base plane in the 3D space
	zAxis: {
	x: number,
	y: number,
	z: number,
},
}
```

### Returns

`[ExtrudeGroup]`




---
title: "yLine"
excerpt: "Draw a line on the y-axis."
layout: manual
---

Draw a line on the y-axis.



```js
yLine(data: AxisLineData, sketch_group: SketchGroup) -> SketchGroup
```

### Examples

```js
startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> yLine(10, %)
  |> line([10, 10], %)
  |> close(%, "edge1")
  |> extrude(10, %)
```

### Arguments

* `data`: `AxisLineData` - Data to draw a line on an axis. (REQUIRED)
```js
{
	// The length of the line.
	length: number,
	// The tag.
	tag: string,
} |
number
```
* `sketch_group`: `SketchGroup` - A sketch group is a collection of paths. (REQUIRED)
```js
{
	// The plane id or face id of the sketch group.
	entityId: uuid,
	// The id of the sketch group.
	id: uuid,
	// What the sketch is on (can be a plane or a face).
	on: {
	// The id of the plane.
	id: uuid,
	// Origin of the plane.
	origin: {
	x: number,
	y: number,
	z: number,
},
	type: "plane",
	// Type for a plane.
	value: "XY" | "XZ" | "YZ" | "Custom",
	// What should the plane’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the plane’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
} |
{
	// The id of the face.
	id: uuid,
	// The original sketch group id of the object we are sketching on.
	sketchGroupId: uuid,
	type: "face",
	// The tag of the face.
	value: string,
	// What should the face’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the face’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
},
	// The position of the sketch group.
	position: [number, number, number],
	// The rotation of the sketch group base plane.
	rotation: [number, number, number, number],
	// The starting path.
	start: {
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
},
	// The paths in the sketch group.
	value: [{
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
	// The x-axis of the sketch group base plane in the 3D space
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// The y-axis of the sketch group base plane in the 3D space
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis of the sketch group base plane in the 3D space
	zAxis: {
	x: number,
	y: number,
	z: number,
},
}
```

### Returns

`SketchGroup` - A sketch group is a collection of paths.
```js
{
	// The plane id or face id of the sketch group.
	entityId: uuid,
	// The id of the sketch group.
	id: uuid,
	// What the sketch is on (can be a plane or a face).
	on: {
	// The id of the plane.
	id: uuid,
	// Origin of the plane.
	origin: {
	x: number,
	y: number,
	z: number,
},
	type: "plane",
	// Type for a plane.
	value: "XY" | "XZ" | "YZ" | "Custom",
	// What should the plane’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the plane’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
} |
{
	// The id of the face.
	id: uuid,
	// The original sketch group id of the object we are sketching on.
	sketchGroupId: uuid,
	type: "face",
	// The tag of the face.
	value: string,
	// What should the face’s X axis be?
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// What should the face’s Y axis be?
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis (normal).
	zAxis: {
	x: number,
	y: number,
	z: number,
},
},
	// The position of the sketch group.
	position: [number, number, number],
	// The rotation of the sketch group base plane.
	rotation: [number, number, number, number],
	// The starting path.
	start: {
	// The from point.
	from: [number, number],
	// The name of the path.
	name: string,
	// The to point.
	to: [number, number],
},
	// The paths in the sketch group.
	value: [{
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
	// The x-axis of the sketch group base plane in the 3D space
	xAxis: {
	x: number,
	y: number,
	z: number,
},
	// The y-axis of the sketch group base plane in the 3D space
	yAxis: {
	x: number,
	y: number,
	z: number,
},
	// The z-axis of the sketch group base plane in the 3D space
	zAxis: {
	x: number,
	y: number,
	z: number,
},
}
```




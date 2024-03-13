---
title: "import"
excerpt: "Import a CAD file."
layout: manual
---

Import a CAD file.

For formats lacking unit data (STL, OBJ, PLY), the default import unit is millimeters. Otherwise you can specify the unit by passing in the options parameter. If you import a gltf file, we will try to find the bin file and import it as well.
Import paths are relative to the current project directory. This only works in the desktop app not in browser.

```js
import(file_path: String, options?: ImportFormat) -> ImportedGeometry
```

### Examples

```js
const model = import("thing.obj")
```

```js
const model = import("cube.obj", { type: "obj", units: "m" })
```

```js
const model = import("my_model.gltf")
```

```js
const model = import("my_model.sldprt")
```

```js
const model = import("my_model.step")
```

### Arguments

* `file_path`: `String` (REQUIRED)
* `options`: `ImportFormat` - Import format specifier (OPTIONAL)
```js
{
	type: "fbx",
} |
{
	type: "gltf",
} |
{
	// Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system.
	coords: {
	// Axis the front face of a model looks along.
	forward: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
	// Axis pointing up and away from a model.
	up: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
},
	type: "obj",
	// The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters.
	units: "cm" | "ft" | "in" | "m" | "mm" | "yd",
} |
{
	// Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system.
	coords: {
	// Axis the front face of a model looks along.
	forward: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
	// Axis pointing up and away from a model.
	up: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
},
	type: "ply",
	// The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters.
	units: "cm" | "ft" | "in" | "m" | "mm" | "yd",
} |
{
	type: "sldprt",
} |
{
	type: "step",
} |
{
	// Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system.
	coords: {
	// Axis the front face of a model looks along.
	forward: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
	// Axis pointing up and away from a model.
	up: {
	// Axis specifier.
	axis: "y" | "z",
	// Specifies which direction the axis is pointing.
	direction: "positive" | "negative",
},
},
	type: "stl",
	// The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters.
	units: "cm" | "ft" | "in" | "m" | "mm" | "yd",
}
```

### Returns

`ImportedGeometry` - Data for an imported geometry.
```js
{
	// The ID of the imported geometry.
	id: uuid,
	// The original file paths.
	value: [string],
}
```




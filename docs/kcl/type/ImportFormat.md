---
title: "ImportFormat"
excerpt: "Import format specifier"
layout: manual
---

Import format specifier


**oneOf**




**This schema accepts exactly one of the following:**

Autodesk Filmbox (FBX) format


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `fbx`
 |  | No |


----
Binary glTF 2.0. We refer to this as glTF since that is how our customers refer to it, but this can also import binary glTF (glb).


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `gltf`
 |  | No |


----
Wavefront OBJ format.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `coords` | `object`
 | Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `type` | enum: `obj`
 |  | No |
| `units` | oneOf
 | The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----
The PLY Polygon File Format.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `coords` | `object`
 | Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `type` | enum: `ply`
 |  | No |
| `units` | oneOf
 | The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----
SolidWorks part (SLDPRT) format.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `sldprt`
 |  | No |


----
ISO 10303-21 (STEP) format.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `step`
 |  | No |


----
ST**ereo**L**ithography format.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `coords` | `object`
 | Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `type` | enum: `stl`
 |  | No |
| `units` | oneOf
 | The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----





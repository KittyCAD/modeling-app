---
title: "ImportFormat"
excerpt: "Import format specifier"
layout: manual
---

Import format specifier




**This schema accepts exactly one of the following:**

Autodesk Filmbox (FBX) format


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `fbx`|  | No |


----
Binary glTF 2.0. We refer to this as glTF since that is how our customers refer to it, but this can also import binary glTF (glb).


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `gltf`|  | No |


----
Wavefront OBJ format.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `obj`|  | No |
| `coords` |`object`| Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `units` |**oneOf:** enum: `cm` **OR** enum: `ft` **OR** enum: `in` **OR** enum: `m` **OR** enum: `mm` **OR** enum: `yd`| The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----
The PLY Polygon File Format.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ply`|  | No |
| `coords` |`object`| Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `units` |**oneOf:** enum: `cm` **OR** enum: `ft` **OR** enum: `in` **OR** enum: `m` **OR** enum: `mm` **OR** enum: `yd`| The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----
SolidWorks part (SLDPRT) format.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sldprt`|  | No |


----
ISO 10303-21 (STEP) format.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `step`|  | No |


----
ST**ereo**L**ithography format.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `stl`|  | No |
| `coords` |`object`| Co-ordinate system of input data. Defaults to the [KittyCAD co-ordinate system. | No |
| `units` |**oneOf:** enum: `cm` **OR** enum: `ft` **OR** enum: `in` **OR** enum: `m` **OR** enum: `mm` **OR** enum: `yd`| The units of the input data. This is very important for correct scaling and when calculating physics properties like mass, etc. Defaults to millimeters. | No |


----





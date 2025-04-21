---
title: "Path"
excerpt: "A path."
layout: manual
---

A path.





**This schema accepts exactly one of the following:**

A path that goes to a point.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ToPoint`|  | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A arc that is tangential to the last path segment that goes to a point

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `TangentialArcTo`|  | No |
| `center` |`[number, number]`| the arc's center | No |
| `ccw` |`boolean`| arc's direction | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A arc that is tangential to the last path segment

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `TangentialArc`|  | No |
| `center` |`[number, number]`| the arc's center | No |
| `ccw` |`boolean`| arc's direction | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
a complete arc

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Circle`|  | No |
| `center` |`[number, number]`| the arc's center | No |
| `radius` |[`number`](/docs/kcl/types/number)| the arc's radius | No |
| `ccw` |`boolean`| arc's direction This is used to compute the tangential angle. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A base path.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `CircleThreePoint`|  | No |
| `p1` |`[number, number]`| Point 1 of the circle | No |
| `p2` |`[number, number]`| Point 2 of the circle | No |
| `p3` |`[number, number]`| Point 3 of the circle | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A base path.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ArcThreePoint`|  | No |
| `p1` |`[number, number]`| Point 1 of the arc (base on the end of previous segment) | No |
| `p2` |`[number, number]`| Point 2 of the arc (interiorAbsolute kwarg) | No |
| `p3` |`[number, number]`| Point 3 of the arc (endAbsolute kwarg) | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A path that is horizontal.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Horizontal`|  | No |
| `x` |[`number`](/docs/kcl/types/number)| The x coordinate. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
An angled line to.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `AngledLineTo`|  | No |
| `x` |[`number`](/docs/kcl/types/number)| The x coordinate. | No |
| `y` |[`number`](/docs/kcl/types/number)| The y coordinate. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A base path.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Base`|  | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A circular arc, not necessarily tangential to the current point.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Arc`|  | No |
| `center` |`[number, number]`| Center of the circle that this arc is drawn on. | No |
| `radius` |[`number`](/docs/kcl/types/number)| Radius of the circle that this arc is drawn on. | No |
| `ccw` |`boolean`| True if the arc is counterclockwise. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |
| [`tag`](/docs/kcl/types/tag) |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----





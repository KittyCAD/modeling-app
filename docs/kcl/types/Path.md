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
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A arc that is tangential to the last path segment that goes to a point

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `TangentialArcTo`|  | No |
| `center` |`[number, number]`| the arc&#x27;s center | No |
| `ccw` |`boolean`| arc&#x27;s direction | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A arc that is tangential to the last path segment

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `TangentialArc`|  | No |
| `center` |`[number, number]`| the arc&#x27;s center | No |
| `ccw` |`boolean`| arc&#x27;s direction | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
a complete arc

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Circle`|  | No |
| `center` |`[number, number]`| the arc&#x27;s center | No |
| `radius` |`number`| the arc&#x27;s radius | No |
| `ccw` |`boolean`| arc&#x27;s direction | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
A path that is horizontal.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Horizontal`|  | No |
| `x` |`number`| The x coordinate. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----
An angled line to.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `AngledLineTo`|  | No |
| `x` |`number`| The x coordinate. | No |
| `y` |`number`| The y coordinate. | No |
| `from` |`[number, number]`| The from point. | No |
| `to` |`[number, number]`| The to point. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
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
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag of the path. | No |
| `__geoMeta` |[`GeoMeta`](/docs/kcl/types/GeoMeta)| Metadata. | No |


----





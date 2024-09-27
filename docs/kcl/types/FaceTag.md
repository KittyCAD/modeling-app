---
title: "FaceTag"
excerpt: "A tag for a face."
layout: manual
---

A tag for a face.



**This schema accepts any of the following:**





**This schema accepts exactly one of the following:**

The start face as in before you extruded. This could also be known as the bottom face. But we do not call it bottom because it would be the top face if you extruded it in the opposite direction or flipped the camera.


**enum:** `start`






----
The end face after you extruded. This could also be known as the top face. But we do not call it top because it would be the bottom face if you extruded it in the opposite direction or flipped the camera.


**enum:** `end`






----




----
A tag for the face.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `value` |`string`|  | No |
| `info` |`object`| Engine information for a tag. | No |
| `__meta` |`array`|  | No |


----






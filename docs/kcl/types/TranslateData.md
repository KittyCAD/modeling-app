---
title: "TranslateData"
excerpt: "Data for moving a solid."
layout: manual
---

Data for moving a solid.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `translate` |`[number, number, number]`| The amount to move the solid in all three axes. | No |
| `global` |`boolean`| If true, the transform is applied in global space. If false, the transform is applied in local sketch axis. Default is false. Meaning, if you were sketching on 'XY' and you wanted to move the solid in the z direction, you would set the above as [0, 0, 1]. If you were sketching on 'XZ' and you wanted to move the solid in the y direction, you would set the above as [0, 0, 1]. | No |



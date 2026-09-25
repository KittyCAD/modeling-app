---
title: "bodyOf"
subtitle: "Function in std"
excerpt: "Select a nested body from imported geometry. Use the child-index path reported by the imported model's topology. The returned body can be passed to operations and topology functions just like the root imported geometry."
layout: manual
---

Select a nested body from imported geometry. Use the child-index path reported by the imported model's topology. The returned body can be passed to operations and topology functions just like the root imported geometry.

```kcl
bodyOf(
  @body: ImportedGeometry,
  path: [number(_); 1+],
): ImportedGeometry
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | Imported geometry containing the nested body. | Yes |
| `path` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 1+] | Child-index path from `body` to the nested body. | Yes |

### Returns

[`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) - Represents geometry which is defined using some other CAD system and imported into KCL.


### Examples

```kcl
@(targetRepresentation = brep)
import "assembly.step" as assembly

bracket = bodyOf(assembly, path = [3, 7])
bracketFace = faceId(bracket, index = 4)

```





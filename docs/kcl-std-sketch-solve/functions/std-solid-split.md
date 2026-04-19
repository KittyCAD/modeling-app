---
title: "split"
subtitle: "Function in std::solid"
excerpt: "Split all faces of the target body along all faces of the tool bodies."
layout: manual
---

Split all faces of the target body along all faces of the tool bodies.

```kcl
split(
  @targets: [Solid; 1+],
  merge?: bool,
  keepTools?: bool,
  tools?: [Solid],
  legacyMethod?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `targets` | `[Solid; 1+]` | The bodies to split | Yes |
| `merge` | `bool` | Whether to merge the bodies into one after. Defaults to false. | No |
| `keepTools` | `bool` | If false, the tool bodies will be removed from the scene. If true, they'll be kept. Defaults to false. | No |
| `tools` | `[Solid]` | The tools to split the target bodies along. | No |
| `legacyMethod` | `bool` | You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

`[Solid; 1+]`




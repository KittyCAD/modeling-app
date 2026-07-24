---
title: "planarSurface"
subtitle: "Function in std::sketch"
excerpt: ""
layout: manual
---



```kcl
planarSurface(@sketches: [Sketch | TaggedEdge | Edge | Segment; 1+]): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | Which sketch or sketches should be extruded. | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]




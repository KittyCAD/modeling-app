---
title: "hide"
subtitle: "Function in std::transform"
excerpt: "Hide solids, sketches, helices, or imported objects."
layout: manual
---

Hide solids, sketches, helices, or imported objects.

```kcl
hide(@objects: [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+]): [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+]
```

Hidden objects remain in the model and can still be referenced by later operations.
Hiding can be useful to see hard-to-reach vantages, or clarify overlapping geometry
while you work.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+] | The object or objects to hide. | Yes |

### Returns

[Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+]




---
title: "view::oriented"
subtitle: "Function in std::view"
excerpt: "Create a camera view that looks at the model from a standard orientation."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a camera view that looks at the model from a standard orientation.

```kcl
view::oriented(
  @orientation: Orientation,
  target?: Point3d,
  distance?: number(Length),
  projection?: Projection,
): CameraView
```

The returned value stores intent, not resolved numbers: an argument you
omit stays absent, and the consumer that activates the view resolves it
against the model it is showing, so one view value is valid for any model.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `orientation` | [`Orientation`](/docs/kcl-std/types/std-view-Orientation) | The standard orientation the camera looks from. | Yes |
| `target` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The point the camera looks at. When omitted, the view centers on the bounds of the model at activation. | No |
| `distance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The distance from the camera to the target. When omitted, the view fits the model at activation. | No |
| `projection` | [`Projection`](/docs/kcl-std/types/std-view-Projection) | The camera projection. When omitted, the view is orthographic, so the same file renders identically in every consumer. | No |

### Returns

[`CameraView`](/docs/kcl-std/types/std-view-CameraView) - A camera viewpoint, stored as intent: what the camera looks at and from which direction, not a snapshot of engine camera state.


### Examples

```kcl
@settings(experimentalFeatures = allow)

isoView = view::oriented(view::Orientation::Isometric)

frontView = view::oriented(
  view::Orientation::Front,
  target = [0, 0, 0],
  distance = 500,
  projection = view::Projection::Perspective,
)

```





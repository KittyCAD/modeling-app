---
title: "view::directed"
subtitle: "Function in std::view"
excerpt: "Create a camera view that looks along a custom direction."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a camera view that looks along a custom direction.

```kcl
view::directed(
  @direction: Point3d,
  up?: Point3d,
  target?: Point3d,
  distance?: number(Length),
  projection?: Projection,
): CameraView
```

The returned value stores intent, not resolved numbers: an argument you
omit stays absent, and the consumer that activates the view resolves it
against the model it is showing, so one view value is valid for any model.

`direction` and `up` set only directions: both are normalized when the
view is constructed, so their magnitudes carry no information and zoom
comes from `distance`. Each must be a non-zero vector, and they must not
be parallel or nearly parallel to each other; such arguments are errors.
Any angle above roughly 0.00006 degrees between the two is accepted, so
only vectors that are parallel to within a rounding error are rejected.
When that happens, choose an `up` that does not lie along `direction`.

Every argument you pass must be a finite number; an infinite or undefined
value, such as one produced by dividing by zero, is an error rather than
a stored value no consumer could use.

Lengths are recorded in millimeters whatever unit you write them in, so
`distance = 2inch` is stored as 50.8mm, and a `target` coordinate is
converted the same way. The view means the same thing either way; a tool
that reads the view back reports millimeters. `direction` and `up` carry
no unit at all, because only their ratio matters.

A `distance` is a separation, so it must be greater than zero. Zero would
put the camera on the point it looks at, and a negative value would put it
behind that point; both are errors rather than a camera nobody can
resolve. A `target` is a point, so its coordinates may be negative.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `direction` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The direction the camera looks, from the camera toward the target. | Yes |
| `up` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The camera's up direction. When omitted, `[0, 0, 1]`: the positive Z axis, which is the modeling app's world up. | No |
| `target` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The point the camera looks at. When omitted, the view centers on the bounds of the model at activation. | No |
| `distance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The distance from the camera to the target. Must be greater than zero. When omitted, the view fits the model at activation. | No |
| `projection` | [`Projection`](/docs/kcl-std/types/std-view-Projection) | The camera projection. When omitted, the view is orthographic, so the same file renders identically in every consumer. | No |

### Returns

[`CameraView`](/docs/kcl-std/types/std-view-CameraView) - A camera viewpoint, stored as intent: what the camera looks at and from which direction, not a snapshot of engine camera state.


### Examples

```kcl
@settings(experimentalFeatures = allow)

overheadView = view::directed([0, 1, -2])

closeUp = view::directed(
  [-1, -1, -0.3],
  up = [0, 0, 1],
  target = [0, 0, 10],
  distance = 200,
  projection = view::Projection::Perspective,
)

```





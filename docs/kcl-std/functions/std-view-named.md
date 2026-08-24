---
title: "view::named"
subtitle: "Function in std::view"
excerpt: "Create a named view: a camera paired with the objects the view shows or hides."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a named view: a camera paired with the objects the view shows or hides.

```kcl
view::named(
  @name: string,
  camera: CameraView,
  baseline: Visibility,
  except?: [Solid | Sketch | GdtAnnotation; 1+],
): NamedView
```

A view is data, not an action. Creating one moves no camera and changes
nothing about what is visible; a consumer such as the modeling app or a
STEP export activates it later, which is why the same file yields the same
views on every machine.

The name is display text, so it may contain spaces and punctuation. It is
required, because a view is identified by the name you give it and not by
the variable you bind it to, so renaming a variable never renames a view.
Names are unique within one file and compared exactly, which makes `Front`
and `front` two different views. Four names are rejected:

- the empty string, which identifies nothing;
- a name of nothing but whitespace, which displays as nothing;
- a name that starts or ends with whitespace, which a reader cannot see but
  the exact comparison above counts;
- `Default View`, which is reserved for the view of the scene generated on
  successful execution of the program.

`baseline` and `except` together decide what the view shows. You start from a
clean state: `baseline` sets the visibility every object takes, and `except`
lists the objects that depart from it. Every view writes its baseline out, so
what a view shows can be read from the call alone:

- `baseline = Visibility::Show` alone: everything is visible;
- `baseline = Visibility::Show` with `except = [a, b]`: everything is
  visible except `a` and `b`;
- `baseline = Visibility::Hide` with `except = [a, b]`: only `a` and `b`
  are visible;
- `baseline = Visibility::Hide` alone: nothing is visible.

Duplicates in `except` are dropped, so listing an object twice does the same
as listing it once.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `name` | [`string`](/docs/kcl-std/types/std-types-string) | The name of the view, as a reader should see it. Required, unique within the file, and compared exactly. | Yes |
| `camera` | [`CameraView`](/docs/kcl-std/types/std-view-CameraView) | The camera the view activates. Call `view::oriented()` or `view::directed()` to build one. | Yes |
| `baseline` | [`Visibility`](/docs/kcl-std/types/std-view-Visibility) | The default visibility of every object the program creates: visible under `Visibility::Show`, hidden under `Visibility::Hide`. Use `except` below to override that default for individual objects. | Yes |
| `except` | [[`Solid`](/docs/kcl-std/types/std-types-Solid) or [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`GdtAnnotation`](/docs/kcl-std/types/std-types-GdtAnnotation); 1+] | The objects the baseline does not apply to: the hidden ones under a `Show` baseline, and the only visible ones under `Hide`. | No |

### Returns

[`NamedView`](/docs/kcl-std/types/std-view-NamedView) - A named view: a camera paired with the set of objects it shows or hides.


### Examples

```kcl
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// Two bodies to look at: a plate, and a boss standing on it. Declaring a
// view never changes what a program builds, so this part is ordinary KCL.
plateSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 60mm, var 0mm])
  edge2 = line(start = [var 60mm, var 0mm], end = [var 60mm, var 40mm])
  edge3 = line(start = [var 60mm, var 40mm], end = [var 0mm, var 40mm])
  edge4 = line(start = [var 0mm, var 40mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}
plate = extrude(region(segments = [plateSketch.edge1, plateSketch.edge2]), length = 5mm)

bossSketch = sketch(on = XY) {
  boundary = circle(start = [var 40mm, var 20mm], center = [var 30mm, var 20mm])
}
boss = extrude(region(segments = [bossSketch.boundary]), length = 12mm)

// This file hides the boss, so the scene generated on successful execution
// shows the plate alone. The views below are unaffected by this call; each
// one states its own visibility from scratch.
hide(boss)

// 1. Everything visible.
//
// This is NOT the same as `Default View`, the view of the scene generated on
// successful execution of the program. A `Show` baseline shows every object
// the program built, including the boss that `hide(boss)` took out of that
// scene.
overview = view::named("Everything", camera = view::oriented(view::Orientation::Isometric), baseline = view::Visibility::Show)

// 2. Visible by default, with one object hidden. Add to `except` to hide
// more.
plateInspection = view::named(
  "Plate only",
  camera = view::oriented(view::Orientation::Front, distance = 200mm),
  baseline = view::Visibility::Show,
  except = [boss],
)

// 3. Hidden by default, with one object shown. This is the form to reach for
// when a view should isolate a few objects out of many, because `except`
// then lists what you want rather than everything you do not.
//
// This one is not assigned to a variable, which a view never requires: the
// display name is what identifies it.
view::named(
  "Boss only",
  camera = view::oriented(view::Orientation::Top, distance = 150mm),
  baseline = view::Visibility::Hide,
  except = [boss],
)

```





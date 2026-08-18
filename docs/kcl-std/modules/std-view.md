---
title: "view"
subtitle: "Module in std"
excerpt: "Named views: cameras and visibility sets defined in KCL. "
layout: manual
---

**WARNING:** This module is experimental and may change or be removed.

Named views: cameras and visibility sets defined in KCL. 

A named view pairs a camera with a set of visible objects, so consumers
such as the modeling app and STEP export can reproduce it. Build a camera by
calling `view::oriented()` or `view::directed()`, then name a view by calling
`view::named()`.



## Functions and constants

* [`view::directed`](/docs/kcl-std/functions/std-view-directed)
* [`view::named`](/docs/kcl-std/functions/std-view-named)
* [`view::oriented`](/docs/kcl-std/functions/std-view-oriented)

## Types

* [`view::CameraView`](/docs/kcl-std/types/std-view-CameraView)
* [`view::NamedView`](/docs/kcl-std/types/std-view-NamedView)
* [`view::Orientation`](/docs/kcl-std/types/std-view-Orientation)
* [`view::Projection`](/docs/kcl-std/types/std-view-Projection)
* [`view::Visibility`](/docs/kcl-std/types/std-view-Visibility)

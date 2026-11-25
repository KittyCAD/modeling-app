# Drawings

The Drawings editor mode displays paper sheets declared in KCL, with sheet tabs,
pan and zoom controls, and rulers in millimeters. It evaluates the document and
its working imports locally. Opening this mode does not create an engine connection.

Enable the project-shell feature, open a KCL file, and choose **Drawings** from its
editor mode menu. Drawing sheet declarations require KCL 4.0-preview:

```kcl
@settings(kclVersion = "4.0-preview")

portrait = drawing::standardSheet(
  size = drawing::SheetSize::IsoA4,
  orientation = drawing::SheetOrientation::Portrait,
)
landscape = drawing::standardSheet(
  size = drawing::SheetSize::AnsiA,
  orientation = drawing::SheetOrientation::Landscape,
)
detail = drawing::customSheet(
  width = 200mm,
  height = 300mm,
  orientation = drawing::SheetOrientation::Landscape,
  name = "Assembly detail",
)
```

Each top-level sheet declaration becomes a tab. Paper sizes retain their physical
dimensions when the file uses a different default length unit. This prototype
shows paper and rulers; geometry projections and drawing annotations are not
implemented.

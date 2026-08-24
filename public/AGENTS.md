# Modeling-app agent notes

## Current KCL samples

Files under `public/kcl-samples` are user-facing, current KCL examples. Write
constraint-based sketch blocks with `sketch(on = ...) { ... }`, build closed
profiles with `region(...)`, and use `faceOf(...)` for sketching on solid faces.

Do not use deprecated profile-pipe sketch APIs in current samples, including
`startSketchOn`, `startProfile`, `xLine`, `yLine`, `angledLine`,
`tangentialArc`, or `close()`. Do not pass a sketch or surface as a positional
argument to `circle`, `rectangle`, or `polygon`; define those segments inside
a sketch block.

Format and lint every changed KCL file with Zoo CLI. Execute and visually
compare affected samples before claiming that their geometry is preserved.

```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[54, 89, 5]"]
    3["Segment<br>[54, 89, 5]"]
    4[Solid2d]
  end
  1["Plane<br>[29, 46, 5]"]
  5["Sweep Extrusion<br>[200, 219, 5]"]
  6[Wall]
  7["Cap Start"]
  8["Cap End"]
  9["SweepEdge Opposite"]
  10["SweepEdge Adjacent"]
  11["Sweep Extrusion<br>[200, 219, 5]"]
  12["Sweep Extrusion<br>[200, 219, 5]"]
  13["Sweep Extrusion<br>[200, 219, 5]"]
  14["Sweep Extrusion<br>[200, 219, 5]"]
  15["Sweep Extrusion<br>[200, 219, 5]"]
  16["Sweep Extrusion<br>[200, 219, 5]"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 --- 6
  3 --- 9
  3 --- 10
  5 --- 6
  5 --- 7
  5 --- 8
  5 --- 9
  5 --- 10
```

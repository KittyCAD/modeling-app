```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[54, 89, 5]"]
    3["Segment<br>[54, 89, 5]"]
    4[Solid2d]
  end
  subgraph path18 [Path]
    18["Path<br>[54, 89, 5]"]
    19["Segment<br>[54, 89, 5]"]
    20[Solid2d]
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
  17["Plane<br>[29, 46, 5]"]
  21["Sweep Extrusion<br>[200, 219, 5]"]
  22[Wall]
  23["Cap Start"]
  24["Cap End"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["Sweep Extrusion<br>[200, 219, 5]"]
  28["Sweep Extrusion<br>[200, 219, 5]"]
  29["Sweep Extrusion<br>[200, 219, 5]"]
  30["Sweep Extrusion<br>[200, 219, 5]"]
  31["Sweep Extrusion<br>[200, 219, 5]"]
  32["Sweep Extrusion<br>[200, 219, 5]"]
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
  17 --- 18
  18 --- 19
  18 ---- 21
  18 --- 20
  19 --- 22
  19 --- 25
  19 --- 26
  21 --- 22
  21 --- 23
  21 --- 24
  21 --- 25
  21 --- 26
```

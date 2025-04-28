```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[54, 89, 7]"]
    3["Segment<br>[54, 89, 7]"]
    4[Solid2d]
  end
  subgraph path18 [Path]
    18["Path<br>[54, 89, 7]"]
    19["Segment<br>[54, 89, 7]"]
    20[Solid2d]
  end
  1["Plane<br>[29, 46, 7]"]
  5["Sweep Extrusion<br>[200, 219, 7]"]
  6[Wall]
  7["Cap Start"]
  8["Cap End"]
  9["SweepEdge Opposite"]
  10["SweepEdge Adjacent"]
  11["Sweep Extrusion<br>[200, 219, 7]"]
  12["Sweep Extrusion<br>[200, 219, 7]"]
  13["Sweep Extrusion<br>[200, 219, 7]"]
  14["Sweep Extrusion<br>[200, 219, 7]"]
  15["Sweep Extrusion<br>[200, 219, 7]"]
  16["Sweep Extrusion<br>[200, 219, 7]"]
  17["Plane<br>[29, 46, 7]"]
  21["Sweep Extrusion<br>[200, 219, 7]"]
  22[Wall]
  23["Cap Start"]
  24["Cap End"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["Sweep Extrusion<br>[200, 219, 7]"]
  28["Sweep Extrusion<br>[200, 219, 7]"]
  29["Sweep Extrusion<br>[200, 219, 7]"]
  30["Sweep Extrusion<br>[200, 219, 7]"]
  31["Sweep Extrusion<br>[200, 219, 7]"]
  32["Sweep Extrusion<br>[200, 219, 7]"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 --- 6
  3 --- 9
  3 --- 10
  3 x--> 7
  5 --- 6
  5 --- 7
  5 --- 8
  5 --- 9
  5 --- 10
  9 <--x 6
  9 <--x 8
  10 <--x 6
  17 --- 18
  18 --- 19
  18 ---- 21
  18 --- 20
  19 --- 22
  19 --- 25
  19 --- 26
  19 x--> 23
  21 --- 22
  21 --- 23
  21 --- 24
  21 --- 25
  21 --- 26
  25 <--x 22
  25 <--x 24
  26 <--x 22
```

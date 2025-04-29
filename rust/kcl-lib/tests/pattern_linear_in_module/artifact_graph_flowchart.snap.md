```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[54, 89, 8]"]
    5["Segment<br>[54, 89, 8]"]
    7[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[54, 89, 8]"]
    6["Segment<br>[54, 89, 8]"]
    8[Solid2d]
  end
  1["Plane<br>[29, 46, 8]"]
  2["Plane<br>[29, 46, 8]"]
  9["Sweep Extrusion<br>[200, 219, 8]"]
  10["Sweep Extrusion<br>[200, 219, 8]"]
  11["Sweep Extrusion<br>[200, 219, 8]"]
  12["Sweep Extrusion<br>[200, 219, 8]"]
  13["Sweep Extrusion<br>[200, 219, 8]"]
  14["Sweep Extrusion<br>[200, 219, 8]"]
  15["Sweep Extrusion<br>[200, 219, 8]"]
  16["Sweep Extrusion<br>[200, 219, 8]"]
  17["Sweep Extrusion<br>[200, 219, 8]"]
  18["Sweep Extrusion<br>[200, 219, 8]"]
  19["Sweep Extrusion<br>[200, 219, 8]"]
  20["Sweep Extrusion<br>[200, 219, 8]"]
  21["Sweep Extrusion<br>[200, 219, 8]"]
  22["Sweep Extrusion<br>[200, 219, 8]"]
  23[Wall]
  24[Wall]
  25["Cap Start"]
  26["Cap End"]
  27["Cap Start"]
  28["Cap End"]
  29["SweepEdge Opposite"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 7
  3 ---- 19
  4 --- 6
  4 --- 8
  4 ---- 15
  5 --- 24
  5 x--> 27
  5 --- 31
  5 --- 32
  6 --- 23
  6 x--> 25
  6 --- 29
  6 --- 30
  15 --- 23
  15 --- 25
  15 --- 26
  15 --- 29
  15 --- 30
  19 --- 24
  19 --- 27
  19 --- 28
  19 --- 31
  19 --- 32
  29 <--x 23
  30 <--x 23
  31 <--x 24
  32 <--x 24
  29 <--x 26
  31 <--x 28
```

```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[35, 68, 0]"]
    3["Segment<br>[74, 114, 0]"]
    4["Segment<br>[186, 194, 0]"]
    5[Solid2d]
  end
  subgraph path15 [Path]
    15["Path<br>[265, 290, 0]"]
    16["Segment<br>[296, 315, 0]"]
    17["Segment<br>[372, 380, 0]"]
    18[Solid2d]
  end
  1["Plane<br>[10, 29, 0]"]
  6["Sweep Extrusion<br>[200, 219, 0]"]
  7[Wall]
  8[Wall]
  9["Cap Start"]
  10["Cap End"]
  11["SweepEdge Opposite"]
  12["SweepEdge Adjacent"]
  13["SweepEdge Opposite"]
  14["SweepEdge Adjacent"]
  19["Sweep Extrusion<br>[386, 405, 0]"]
  20[Wall]
  21[Wall]
  22["Cap Start"]
  23["Cap End"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Opposite"]
  27["SweepEdge Adjacent"]
  28["StartSketchOnFace<br>[231, 259, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 ---- 6
  2 --- 5
  3 --- 8
  3 --- 13
  3 --- 14
  4 --- 7
  4 --- 11
  4 --- 12
  6 --- 7
  6 --- 8
  6 --- 9
  6 --- 10
  6 --- 11
  6 --- 12
  6 --- 13
  6 --- 14
  8 --- 15
  15 --- 16
  15 --- 17
  15 ---- 19
  15 --- 18
  16 --- 21
  16 --- 26
  16 --- 27
  17 --- 20
  17 --- 24
  17 --- 25
  19 --- 20
  19 --- 21
  19 --- 22
  19 --- 23
  19 --- 24
  19 --- 25
  19 --- 26
  19 --- 27
  8 <--x 28
```

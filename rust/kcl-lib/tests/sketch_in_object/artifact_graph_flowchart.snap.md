```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[48, 73, 0]"]
    3["Segment<br>[81, 99, 0]"]
    4["Segment<br>[160, 168, 0]"]
    5[Solid2d]
  end
  subgraph path16 [Path]
    16["Path<br>[257, 282, 0]"]
    17["Segment<br>[294, 312, 0]"]
    18["Segment<br>[385, 393, 0]"]
    19[Solid2d]
  end
  1["Plane<br>[21, 40, 0]"]
  6["Sweep Extrusion<br>[425, 446, 0]"]
  7[Wall]
  8[Wall]
  9["Cap Start"]
  10["Cap End"]
  11["SweepEdge Opposite"]
  12["SweepEdge Adjacent"]
  13["SweepEdge Opposite"]
  14["SweepEdge Adjacent"]
  15["Plane<br>[226, 245, 0]"]
  20["Sweep Extrusion<br>[483, 503, 0]"]
  21[Wall]
  22[Wall]
  23["Cap Start"]
  24["Cap End"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Opposite"]
  28["SweepEdge Adjacent"]
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
  15 --- 16
  16 --- 17
  16 --- 18
  16 ---- 20
  16 --- 19
  17 --- 22
  17 --- 27
  17 --- 28
  18 --- 21
  18 --- 25
  18 --- 26
  20 --- 21
  20 --- 22
  20 --- 23
  20 --- 24
  20 --- 25
  20 --- 26
  20 --- 27
  20 --- 28
```

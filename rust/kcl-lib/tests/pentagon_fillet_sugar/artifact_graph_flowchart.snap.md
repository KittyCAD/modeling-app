```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[96, 121, 0]"]
    3["Segment<br>[127, 181, 0]"]
    4["Segment<br>[187, 242, 0]"]
    5["Segment<br>[248, 303, 0]"]
  end
  subgraph path18 [Path]
    18["Path<br>[409, 460, 0]"]
    19["Segment<br>[468, 582, 0]"]
    20["Segment<br>[590, 598, 0]"]
    21[Solid2d]
  end
  subgraph path29 [Path]
    29["Path<br>[409, 460, 0]"]
    30["Segment<br>[468, 582, 0]"]
    31["Segment<br>[590, 598, 0]"]
    32[Solid2d]
  end
  1["Plane<br>[73, 90, 0]"]
  6["Sweep Extrusion<br>[309, 341, 0]"]
  7[Wall]
  8[Wall]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  14["SweepEdge Opposite"]
  15["SweepEdge Adjacent"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
  22["Sweep Extrusion<br>[641, 669, 0]"]
  23[Wall]
  24["Cap End"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["EdgeCut Fillet<br>[675, 802, 0]"]
  28["EdgeCut Fillet<br>[675, 802, 0]"]
  33["Sweep Extrusion<br>[841, 869, 0]"]
  34[Wall]
  35["Cap End"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["EdgeCut Fillet<br>[875, 1002, 0]"]
  39["EdgeCut Fillet<br>[875, 1002, 0]"]
  40["StartSketchOnFace<br>[372, 401, 0]"]
  41["StartSketchOnFace<br>[372, 401, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 ---- 6
  3 --- 7
  3 --- 12
  3 --- 13
  3 x--> 10
  4 --- 8
  4 --- 14
  4 --- 15
  4 x--> 10
  5 --- 9
  5 --- 16
  5 --- 17
  5 x--> 10
  6 --- 7
  6 --- 8
  6 --- 9
  6 --- 10
  6 --- 11
  6 --- 12
  6 --- 13
  6 --- 14
  6 --- 15
  6 --- 16
  6 --- 17
  7 --- 29
  9 --- 18
  12 <--x 7
  12 <--x 11
  13 <--x 7
  13 <--x 8
  14 <--x 8
  14 <--x 11
  15 <--x 8
  15 <--x 9
  16 <--x 9
  16 <--x 11
  17 <--x 7
  17 <--x 9
  18 --- 19
  18 --- 20
  18 ---- 22
  18 --- 21
  19 --- 23
  19 --- 25
  19 --- 26
  19 --- 27
  19 <--x 9
  22 --- 23
  22 --- 24
  22 --- 25
  22 --- 26
  26 <--x 23
  25 <--x 28
  29 --- 30
  29 --- 31
  29 ---- 33
  29 --- 32
  30 --- 34
  30 --- 36
  30 --- 37
  30 --- 38
  30 <--x 7
  33 --- 34
  33 --- 35
  33 --- 36
  33 --- 37
  37 <--x 34
  36 <--x 39
  9 <--x 40
  7 <--x 41
```

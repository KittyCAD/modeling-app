```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[673, 743, 0]"]
    3["Segment<br>[673, 743, 0]"]
    4[Solid2d]
  end
  subgraph path13 [Path]
    13["Path<br>[976, 1057, 0]"]
    14["Segment<br>[1063, 1114, 0]"]
    15["Segment<br>[1120, 1171, 0]"]
    16["Segment<br>[1177, 1228, 0]"]
    17["Segment<br>[1234, 1284, 0]"]
    18["Segment<br>[1290, 1340, 0]"]
    19["Segment<br>[1346, 1353, 0]"]
    20[Solid2d]
  end
  subgraph path41 [Path]
    41["Path<br>[1452, 1521, 0]"]
    42["Segment<br>[1452, 1521, 0]"]
    43[Solid2d]
  end
  1["Plane<br>[650, 667, 0]"]
  5["Sweep Extrusion<br>[749, 782, 0]"]
  6[Wall]
  7["Cap Start"]
  8["Cap End"]
  9["SweepEdge Opposite"]
  10["SweepEdge Adjacent"]
  11["EdgeCut Fillet<br>[788, 854, 0]"]
  12["EdgeCut Fillet<br>[788, 854, 0]"]
  21["Sweep Extrusion<br>[1359, 1399, 0]"]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27[Wall]
  28["Cap Start"]
  29["SweepEdge Opposite"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Opposite"]
  34["SweepEdge Adjacent"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  44["Sweep Extrusion<br>[1527, 1555, 0]"]
  45[Wall]
  46["Cap End"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["EdgeCut Fillet<br>[1561, 1620, 0]"]
  50["StartSketchOnFace<br>[933, 970, 0]"]
  51["StartSketchOnFace<br>[1411, 1446, 0]"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 --- 6
  3 --- 9
  3 --- 10
  3 --- 11
  3 x--> 8
  5 --- 6
  5 --- 7
  5 --- 8
  5 --- 9
  5 --- 10
  7 --- 13
  8 --- 41
  10 <--x 6
  9 <--x 12
  13 --- 14
  13 --- 15
  13 --- 16
  13 --- 17
  13 --- 18
  13 --- 19
  13 ---- 21
  13 --- 20
  14 --- 27
  14 --- 39
  14 --- 40
  14 <--x 7
  15 --- 26
  15 --- 37
  15 --- 38
  15 <--x 7
  16 --- 25
  16 --- 35
  16 --- 36
  16 <--x 7
  17 --- 24
  17 --- 33
  17 --- 34
  17 <--x 7
  18 --- 23
  18 --- 31
  18 --- 32
  18 <--x 7
  19 --- 22
  19 --- 29
  19 --- 30
  19 <--x 7
  21 --- 22
  21 --- 23
  21 --- 24
  21 --- 25
  21 --- 26
  21 --- 27
  21 --- 28
  21 --- 29
  21 --- 30
  21 --- 31
  21 --- 32
  21 --- 33
  21 --- 34
  21 --- 35
  21 --- 36
  21 --- 37
  21 --- 38
  21 --- 39
  21 --- 40
  29 <--x 22
  29 <--x 28
  30 <--x 22
  30 <--x 27
  31 <--x 23
  31 <--x 28
  32 <--x 22
  32 <--x 23
  33 <--x 24
  33 <--x 28
  34 <--x 23
  34 <--x 24
  35 <--x 25
  35 <--x 28
  36 <--x 24
  36 <--x 25
  37 <--x 26
  37 <--x 28
  38 <--x 25
  38 <--x 26
  39 <--x 27
  39 <--x 28
  40 <--x 26
  40 <--x 27
  41 --- 42
  41 ---- 44
  41 --- 43
  42 --- 45
  42 --- 47
  42 --- 48
  42 <--x 8
  44 --- 45
  44 --- 46
  44 --- 47
  44 --- 48
  48 <--x 45
  47 <--x 49
  7 <--x 50
  8 <--x 51
```

```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[850, 935, 0]"]
    3["Segment<br>[850, 935, 0]"]
    4[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[1172, 1217, 0]"]
    7["Segment<br>[1172, 1217, 0]"]
    8[Solid2d]
  end
  subgraph path15 [Path]
    15["Path<br>[1385, 1439, 0]"]
    16["Segment<br>[1385, 1439, 0]"]
    17[Solid2d]
  end
  subgraph path23 [Path]
    23["Path<br>[1597, 1654, 0]"]
    24["Segment<br>[1597, 1654, 0]"]
    25[Solid2d]
  end
  subgraph path31 [Path]
    31["Path<br>[1784, 1829, 0]"]
    32["Segment<br>[1784, 1829, 0]"]
    33[Solid2d]
  end
  1["Plane<br>[827, 844, 0]"]
  5["Plane<br>[1149, 1166, 0]"]
  9["Sweep Extrusion<br>[1245, 1276, 0]"]
  10[Wall]
  11["Cap Start"]
  12["Cap End"]
  13["SweepEdge Opposite"]
  14["SweepEdge Adjacent"]
  18["Sweep Extrusion<br>[1445, 1480, 0]"]
  19[Wall]
  20["Cap End"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  26["Sweep Extrusion<br>[1660, 1693, 0]"]
  27[Wall]
  28["Cap End"]
  29["SweepEdge Opposite"]
  30["SweepEdge Adjacent"]
  34["Sweep Extrusion<br>[1835, 1910, 0]"]
  35[Wall]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["StartSketchOnFace<br>[1347, 1379, 0]"]
  39["StartSketchOnFace<br>[1557, 1591, 0]"]
  40["StartSketchOnFace<br>[1744, 1778, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  5 --- 6
  6 --- 7
  6 ---- 9
  6 --- 8
  7 --- 10
  7 --- 13
  7 --- 14
  9 --- 10
  9 --- 11
  9 --- 12
  9 --- 13
  9 --- 14
  11 --- 23
  12 --- 15
  15 --- 16
  15 ---- 18
  15 --- 17
  16 --- 19
  16 --- 21
  16 --- 22
  18 --- 19
  18 --- 20
  18 --- 21
  18 --- 22
  20 --- 31
  23 --- 24
  23 ---- 26
  23 --- 25
  24 --- 27
  24 --- 29
  24 --- 30
  26 --- 27
  26 --- 28
  26 --- 29
  26 --- 30
  31 --- 32
  31 ---- 34
  31 --- 33
  32 --- 35
  32 --- 36
  32 --- 37
  34 --- 35
  34 --- 36
  34 --- 37
  12 <--x 38
  11 <--x 39
  20 <--x 40
```

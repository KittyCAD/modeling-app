```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[1016, 1041, 0]"]
    3["Segment<br>[1047, 1092, 0]"]
    4["Segment<br>[1098, 1141, 0]"]
    5["Segment<br>[1147, 1174, 0]"]
    6["Segment<br>[1180, 1238, 0]"]
    7["Segment<br>[1244, 1284, 0]"]
    8["Segment<br>[1290, 1298, 0]"]
    9[Solid2d]
  end
  subgraph path33 [Path]
    33["Path<br>[1530, 1561, 0]"]
    34["Segment<br>[1567, 1592, 0]"]
    35["Segment<br>[1598, 1623, 0]"]
    36["Segment<br>[1629, 1654, 0]"]
    37["Segment<br>[1660, 1716, 0]"]
    38["Segment<br>[1722, 1730, 0]"]
    39[Solid2d]
  end
  1["Plane<br>[991, 1010, 0]"]
  10["Sweep Extrusion<br>[1304, 1327, 0]"]
  11[Wall]
  12[Wall]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17["Cap Start"]
  18["Cap End"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Opposite"]
  24["SweepEdge Adjacent"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Opposite"]
  28["SweepEdge Adjacent"]
  29["SweepEdge Opposite"]
  30["SweepEdge Adjacent"]
  31["EdgeCut Fillet<br>[1333, 1398, 0]"]
  32["EdgeCut Fillet<br>[1404, 1481, 0]"]
  40["Sweep Extrusion<br>[1736, 1756, 0]"]
  41[Wall]
  42[Wall]
  43[Wall]
  44[Wall]
  45["Cap End"]
  46["SweepEdge Opposite"]
  47["SweepEdge Adjacent"]
  48["SweepEdge Opposite"]
  49["SweepEdge Adjacent"]
  50["SweepEdge Opposite"]
  51["SweepEdge Adjacent"]
  52["SweepEdge Opposite"]
  53["SweepEdge Adjacent"]
  54["StartSketchOnFace<br>[1495, 1524, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 ---- 10
  2 --- 9
  3 --- 11
  3 --- 19
  3 --- 20
  4 --- 12
  4 --- 21
  4 --- 22
  5 --- 13
  5 --- 23
  5 --- 24
  6 --- 14
  6 --- 25
  6 --- 26
  7 --- 15
  7 --- 27
  7 --- 28
  8 --- 16
  8 --- 29
  8 --- 30
  10 --- 11
  10 --- 12
  10 --- 13
  10 --- 14
  10 --- 15
  10 --- 16
  10 --- 17
  10 --- 18
  10 --- 19
  10 --- 20
  10 --- 21
  10 --- 22
  10 --- 23
  10 --- 24
  10 --- 25
  10 --- 26
  10 --- 27
  10 --- 28
  10 --- 29
  10 --- 30
  12 --- 33
  26 <--x 31
  20 <--x 32
  33 --- 34
  33 --- 35
  33 --- 36
  33 --- 37
  33 --- 38
  33 ---- 40
  33 --- 39
  34 --- 44
  34 --- 52
  34 --- 53
  35 --- 43
  35 --- 50
  35 --- 51
  36 --- 42
  36 --- 48
  36 --- 49
  37 --- 41
  37 --- 46
  37 --- 47
  40 --- 41
  40 --- 42
  40 --- 43
  40 --- 44
  40 --- 45
  40 --- 46
  40 --- 47
  40 --- 48
  40 --- 49
  40 --- 50
  40 --- 51
  40 --- 52
  40 --- 53
  12 <--x 54
```

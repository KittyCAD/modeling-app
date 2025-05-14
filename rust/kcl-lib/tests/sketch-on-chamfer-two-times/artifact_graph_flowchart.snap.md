```mermaid
flowchart LR
  subgraph path6 [Path]
    6["Path<br>[35, 67, 0]"]
    9["Segment<br>[103, 170, 0]"]
    10["Segment<br>[176, 260, 0]"]
    11["Segment<br>[266, 354, 0]"]
    12["Segment<br>[360, 430, 0]"]
    13["Segment<br>[436, 444, 0]"]
    24[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[719, 753, 0]"]
    14["Segment<br>[759, 825, 0]"]
    15["Segment<br>[831, 929, 0]"]
    16["Segment<br>[935, 1052, 0]"]
    17["Segment<br>[1058, 1114, 0]"]
    18["Segment<br>[1120, 1128, 0]"]
    26[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[1186, 1221, 0]"]
    19["Segment<br>[1227, 1293, 0]"]
    20["Segment<br>[1299, 1398, 0]"]
    21["Segment<br>[1404, 1521, 0]"]
    22["Segment<br>[1527, 1583, 0]"]
    23["Segment<br>[1589, 1597, 0]"]
    25[Solid2d]
  end
  1["Plane<br>[12, 29, 0]"]
  2["Plane<br>[719, 753, 0]"]
  3["Plane<br>[1186, 1221, 0]"]
  4["StartSketchOnFace<br>[1141, 1180, 0]"]
  5["StartSketchOnFace<br>[674, 713, 0]"]
  27["Sweep Extrusion<br>[458, 490, 0]"]
  28["Sweep Extrusion<br>[1611, 1642, 0]"]
  29[Wall]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35[Wall]
  36[Wall]
  37["Cap Start"]
  38["Cap End"]
  39["Cap End"]
  40["SweepEdge Opposite"]
  41["SweepEdge Opposite"]
  42["SweepEdge Opposite"]
  43["SweepEdge Opposite"]
  44["SweepEdge Opposite"]
  45["SweepEdge Opposite"]
  46["SweepEdge Opposite"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Adjacent"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Adjacent"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Adjacent"]
  54["SweepEdge Adjacent"]
  55["SweepEdge Adjacent"]
  56["EdgeCut Fillet<br>[496, 531, 0]"]
  1 --- 6
  2 <--x 5
  2 --- 7
  12 <--x 2
  3 <--x 4
  3 --- 8
  19 <--x 3
  20 <--x 3
  21 <--x 3
  22 <--x 3
  6 --- 9
  6 --- 10
  6 --- 11
  6 --- 12
  6 --- 13
  6 --- 24
  6 ---- 27
  7 --- 14
  7 --- 15
  7 --- 16
  7 --- 17
  7 --- 18
  7 --- 26
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  8 --- 23
  8 --- 25
  8 ---- 28
  9 --- 32
  9 x--> 37
  9 --- 43
  9 --- 51
  10 --- 30
  10 x--> 37
  10 --- 42
  10 --- 50
  10 --- 56
  11 --- 29
  11 x--> 37
  11 --- 41
  11 --- 49
  12 --- 31
  12 x--> 37
  12 --- 40
  12 --- 48
  19 --- 35
  19 --- 47
  19 --- 55
  20 --- 34
  20 --- 46
  20 --- 54
  21 --- 36
  21 --- 45
  21 --- 53
  22 --- 33
  22 --- 44
  22 --- 52
  27 --- 29
  27 --- 30
  27 --- 31
  27 --- 32
  27 --- 37
  27 --- 38
  27 --- 40
  27 --- 41
  27 --- 42
  27 --- 43
  27 --- 48
  27 --- 49
  27 --- 50
  27 --- 51
  28 --- 33
  28 --- 34
  28 --- 35
  28 --- 36
  28 --- 39
  28 --- 44
  28 --- 45
  28 --- 46
  28 --- 47
  28 --- 52
  28 --- 53
  28 --- 54
  28 --- 55
  29 --- 41
  29 --- 49
  50 <--x 29
  30 --- 42
  30 --- 50
  51 <--x 30
  31 --- 40
  31 --- 48
  49 <--x 31
  32 --- 43
  48 <--x 32
  32 --- 51
  33 --- 44
  33 --- 52
  53 <--x 33
  34 --- 46
  34 --- 54
  55 <--x 34
  35 --- 47
  52 <--x 35
  35 --- 55
  36 --- 45
  36 --- 53
  54 <--x 36
  40 <--x 38
  41 <--x 38
  42 <--x 38
  43 <--x 38
  44 <--x 39
  45 <--x 39
  46 <--x 39
  47 <--x 39
```

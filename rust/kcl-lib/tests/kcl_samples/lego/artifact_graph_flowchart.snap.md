```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[1019, 1073, 0]"]
    3["Segment<br>[1079, 1106, 0]"]
    4["Segment<br>[1112, 1140, 0]"]
    5["Segment<br>[1146, 1174, 0]"]
    6["Segment<br>[1180, 1187, 0]"]
    7[Solid2d]
  end
  subgraph path23 [Path]
    23["Path<br>[1434, 1521, 0]"]
    24["Segment<br>[1527, 1564, 0]"]
    25["Segment<br>[1570, 1608, 0]"]
    26["Segment<br>[1614, 1654, 0]"]
    27["Segment<br>[1660, 1667, 0]"]
    28[Solid2d]
  end
  subgraph path43 [Path]
    43["Path<br>[1791, 1938, 0]"]
    44["Segment<br>[1791, 1938, 0]"]
    45[Solid2d]
  end
  subgraph path56 [Path]
    56["Path<br>[2228, 2403, 0]"]
    57["Segment<br>[2228, 2403, 0]"]
    58[Solid2d]
  end
  1["Plane<br>[996, 1013, 0]"]
  8["Sweep Extrusion<br>[1193, 1217, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  29["Sweep Extrusion<br>[1673, 1704, 0]"]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34["Cap Start"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  46["Sweep Extrusion<br>[2092, 2120, 0]"]
  47[Wall]
  48["Cap End"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["Sweep Extrusion<br>[2092, 2120, 0]"]
  52["Sweep Extrusion<br>[2092, 2120, 0]"]
  53["Sweep Extrusion<br>[2092, 2120, 0]"]
  54["Sweep Extrusion<br>[2092, 2120, 0]"]
  55["Sweep Extrusion<br>[2092, 2120, 0]"]
  59["Sweep Extrusion<br>[2565, 2593, 0]"]
  60[Wall]
  61["Cap End"]
  62["SweepEdge Opposite"]
  63["SweepEdge Adjacent"]
  64["Sweep Extrusion<br>[2565, 2593, 0]"]
  65["StartSketchOnFace<br>[1395, 1428, 0]"]
  66["StartSketchOnFace<br>[1754, 1785, 0]"]
  67["StartSketchOnFace<br>[2181, 2222, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 9
  3 --- 15
  3 --- 16
  3 x--> 13
  4 --- 10
  4 --- 17
  4 --- 18
  4 x--> 13
  5 --- 11
  5 --- 19
  5 --- 20
  5 x--> 13
  6 --- 12
  6 --- 21
  6 --- 22
  6 x--> 13
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  13 --- 23
  14 --- 43
  15 <--x 9
  15 <--x 14
  16 <--x 9
  16 <--x 10
  17 <--x 10
  17 <--x 14
  18 <--x 10
  18 <--x 11
  19 <--x 11
  19 <--x 14
  20 <--x 11
  20 <--x 12
  21 <--x 12
  21 <--x 14
  22 <--x 9
  22 <--x 12
  23 --- 24
  23 --- 25
  23 --- 26
  23 --- 27
  23 ---- 29
  23 --- 28
  24 --- 30
  24 --- 35
  24 --- 36
  24 <--x 13
  25 --- 31
  25 --- 37
  25 --- 38
  25 <--x 13
  26 --- 32
  26 --- 39
  26 --- 40
  26 <--x 13
  27 --- 33
  27 --- 41
  27 --- 42
  27 <--x 13
  29 --- 30
  29 --- 31
  29 --- 32
  29 --- 33
  29 --- 34
  29 --- 35
  29 --- 36
  29 --- 37
  29 --- 38
  29 --- 39
  29 --- 40
  29 --- 41
  29 --- 42
  34 --- 56
  35 <--x 30
  35 <--x 34
  36 <--x 30
  36 <--x 31
  37 <--x 31
  37 <--x 34
  38 <--x 31
  38 <--x 32
  39 <--x 32
  39 <--x 34
  40 <--x 32
  40 <--x 33
  41 <--x 33
  41 <--x 34
  42 <--x 30
  42 <--x 33
  43 --- 44
  43 ---- 46
  43 --- 45
  44 --- 47
  44 --- 49
  44 --- 50
  44 <--x 14
  46 --- 47
  46 --- 48
  46 --- 49
  46 --- 50
  49 <--x 47
  49 <--x 48
  50 <--x 47
  56 --- 57
  56 ---- 59
  56 --- 58
  57 --- 60
  57 --- 62
  57 --- 63
  57 <--x 34
  59 --- 60
  59 --- 61
  59 --- 62
  59 --- 63
  62 <--x 60
  62 <--x 61
  63 <--x 60
  13 <--x 65
  14 <--x 66
  34 <--x 67
```

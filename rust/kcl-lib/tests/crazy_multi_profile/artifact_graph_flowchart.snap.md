```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[43, 83, 0]"]
    3["Segment<br>[89, 127, 0]"]
    4["Segment<br>[133, 172, 0]"]
    5["Segment<br>[178, 234, 0]"]
    6["Segment<br>[240, 247, 0]"]
    7[Solid2d]
  end
  subgraph path20 [Path]
    20["Path<br>[359, 399, 0]"]
    21["Segment<br>[405, 429, 0]"]
    22["Segment<br>[435, 460, 0]"]
  end
  subgraph path23 [Path]
    23["Path<br>[474, 513, 0]"]
    24["Segment<br>[519, 584, 0]"]
    25["Segment<br>[590, 658, 0]"]
    26["Segment<br>[664, 752, 0]"]
    27["Segment<br>[758, 814, 0]"]
    28["Segment<br>[820, 827, 0]"]
    29[Solid2d]
  end
  subgraph path30 [Path]
    30["Path<br>[841, 880, 0]"]
    31["Segment<br>[886, 906, 0]"]
    32["Segment<br>[912, 938, 0]"]
    33["Segment<br>[944, 1000, 0]"]
    34["Segment<br>[1006, 1013, 0]"]
    35[Solid2d]
  end
  subgraph path36 [Path]
    36["Path<br>[1027, 1082, 0]"]
    37["Segment<br>[1027, 1082, 0]"]
    38[Solid2d]
  end
  subgraph path39 [Path]
    39["Path<br>[1096, 1135, 0]"]
    40["Segment<br>[1141, 1165, 0]"]
    41["Segment<br>[1171, 1196, 0]"]
    42["Segment<br>[1202, 1258, 0]"]
    43["Segment<br>[1264, 1271, 0]"]
    44[Solid2d]
  end
  subgraph path59 [Path]
    59["Path<br>[1441, 1479, 0]"]
    60["Segment<br>[1485, 1509, 0]"]
    61["Segment<br>[1515, 1540, 0]"]
  end
  subgraph path62 [Path]
    62["Path<br>[1554, 1593, 0]"]
    63["Segment<br>[1599, 1623, 0]"]
    64["Segment<br>[1629, 1654, 0]"]
    65["Segment<br>[1660, 1716, 0]"]
    66["Segment<br>[1722, 1729, 0]"]
    67[Solid2d]
  end
  subgraph path68 [Path]
    68["Path<br>[1743, 1782, 0]"]
    69["Segment<br>[1788, 1811, 0]"]
    70["Segment<br>[1817, 1842, 0]"]
    71["Segment<br>[1848, 1904, 0]"]
    72["Segment<br>[1910, 1917, 0]"]
    73[Solid2d]
  end
  subgraph path74 [Path]
    74["Path<br>[1931, 1987, 0]"]
    75["Segment<br>[1931, 1987, 0]"]
    76[Solid2d]
  end
  subgraph path77 [Path]
    77["Path<br>[2001, 2041, 0]"]
    78["Segment<br>[2047, 2112, 0]"]
    79["Segment<br>[2118, 2186, 0]"]
    80["Segment<br>[2192, 2280, 0]"]
    81["Segment<br>[2286, 2342, 0]"]
    82["Segment<br>[2348, 2355, 0]"]
    83[Solid2d]
  end
  1["Plane<br>[12, 29, 0]"]
  8["Sweep Extrusion<br>[261, 293, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12["Cap Start"]
  13["Cap End"]
  14["SweepEdge Opposite"]
  15["SweepEdge Adjacent"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
  18["SweepEdge Opposite"]
  19["SweepEdge Adjacent"]
  45["Sweep RevolveAboutEdge<br>[1285, 1351, 0]"]
  46["Sweep Extrusion<br>[1365, 1396, 0]"]
  47[Wall]
  48[Wall]
  49[Wall]
  50["Cap Start"]
  51["Cap End"]
  52["SweepEdge Opposite"]
  53["SweepEdge Adjacent"]
  54["SweepEdge Opposite"]
  55["SweepEdge Adjacent"]
  56["SweepEdge Opposite"]
  57["SweepEdge Adjacent"]
  58["Plane<br>[1409, 1427, 0]"]
  84["Sweep Extrusion<br>[2369, 2402, 0]"]
  85[Wall]
  86[Wall]
  87[Wall]
  88[Wall]
  89["Cap Start"]
  90["Cap End"]
  91["SweepEdge Opposite"]
  92["SweepEdge Adjacent"]
  93["SweepEdge Opposite"]
  94["SweepEdge Adjacent"]
  95["SweepEdge Opposite"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Opposite"]
  98["SweepEdge Adjacent"]
  99["Sweep RevolveAboutEdge<br>[2416, 2461, 0]"]
  100[Wall]
  101[Wall]
  102[Wall]
  103["Cap Start"]
  104["Cap End"]
  105["SweepEdge Opposite"]
  106["SweepEdge Adjacent"]
  107["SweepEdge Opposite"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Opposite"]
  110["SweepEdge Adjacent"]
  111["StartSketchOnFace<br>[306, 345, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 11
  3 --- 18
  3 --- 19
  4 --- 10
  4 --- 16
  4 --- 17
  5 --- 9
  5 --- 14
  5 --- 15
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
  10 --- 20
  10 --- 23
  10 --- 30
  10 --- 36
  10 --- 39
  20 --- 21
  20 --- 22
  23 --- 24
  23 --- 25
  23 --- 26
  23 --- 27
  23 --- 28
  23 --- 29
  30 --- 31
  30 --- 32
  30 --- 33
  30 --- 34
  30 ---- 45
  30 --- 35
  36 --- 37
  36 --- 38
  39 --- 40
  39 --- 41
  39 --- 42
  39 --- 43
  39 ---- 46
  39 --- 44
  40 --- 49
  40 --- 56
  40 --- 57
  41 --- 48
  41 --- 54
  41 --- 55
  42 --- 47
  42 --- 52
  42 --- 53
  46 --- 47
  46 --- 48
  46 --- 49
  46 --- 50
  46 --- 51
  46 --- 52
  46 --- 53
  46 --- 54
  46 --- 55
  46 --- 56
  46 --- 57
  58 --- 59
  58 --- 62
  58 --- 68
  58 --- 74
  58 --- 77
  59 --- 60
  59 --- 61
  62 --- 63
  62 --- 64
  62 --- 65
  62 --- 66
  62 ---- 99
  62 --- 67
  63 --- 100
  63 --- 105
  63 --- 106
  64 --- 101
  64 --- 107
  64 --- 108
  65 --- 102
  65 --- 109
  65 --- 110
  68 --- 69
  68 --- 70
  68 --- 71
  68 --- 72
  68 --- 73
  74 --- 75
  74 --- 76
  77 --- 78
  77 --- 79
  77 --- 80
  77 --- 81
  77 --- 82
  77 ---- 84
  77 --- 83
  78 --- 88
  78 --- 97
  78 --- 98
  79 --- 87
  79 --- 95
  79 --- 96
  80 --- 86
  80 --- 93
  80 --- 94
  81 --- 85
  81 --- 91
  81 --- 92
  84 --- 85
  84 --- 86
  84 --- 87
  84 --- 88
  84 --- 89
  84 --- 90
  84 --- 91
  84 --- 92
  84 --- 93
  84 --- 94
  84 --- 95
  84 --- 96
  84 --- 97
  84 --- 98
  99 --- 100
  99 --- 101
  99 --- 102
  99 --- 103
  99 --- 104
  99 --- 105
  99 --- 106
  99 --- 107
  99 --- 108
  99 --- 109
  99 --- 110
  10 <--x 111
```

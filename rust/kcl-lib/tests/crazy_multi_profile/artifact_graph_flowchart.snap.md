```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[45, 85, 0]"]
    3["Segment<br>[91, 129, 0]"]
    4["Segment<br>[135, 174, 0]"]
    5["Segment<br>[180, 236, 0]"]
    6["Segment<br>[242, 249, 0]"]
    7[Solid2d]
  end
  subgraph path20 [Path]
    20["Path<br>[361, 401, 0]"]
    21["Segment<br>[407, 431, 0]"]
    22["Segment<br>[437, 462, 0]"]
  end
  subgraph path23 [Path]
    23["Path<br>[476, 515, 0]"]
    24["Segment<br>[521, 586, 0]"]
    25["Segment<br>[592, 660, 0]"]
    26["Segment<br>[666, 754, 0]"]
    27["Segment<br>[760, 816, 0]"]
    28["Segment<br>[822, 829, 0]"]
    29[Solid2d]
  end
  subgraph path30 [Path]
    30["Path<br>[843, 882, 0]"]
    31["Segment<br>[888, 908, 0]"]
    32["Segment<br>[914, 940, 0]"]
    33["Segment<br>[946, 1002, 0]"]
    34["Segment<br>[1008, 1015, 0]"]
    35[Solid2d]
  end
  subgraph path36 [Path]
    36["Path<br>[1029, 1084, 0]"]
    37["Segment<br>[1029, 1084, 0]"]
    38[Solid2d]
  end
  subgraph path39 [Path]
    39["Path<br>[1098, 1137, 0]"]
    40["Segment<br>[1143, 1167, 0]"]
    41["Segment<br>[1173, 1198, 0]"]
    42["Segment<br>[1204, 1260, 0]"]
    43["Segment<br>[1266, 1273, 0]"]
    44[Solid2d]
  end
  subgraph path59 [Path]
    59["Path<br>[1445, 1483, 0]"]
    60["Segment<br>[1489, 1513, 0]"]
    61["Segment<br>[1519, 1544, 0]"]
  end
  subgraph path62 [Path]
    62["Path<br>[1558, 1597, 0]"]
    63["Segment<br>[1603, 1627, 0]"]
    64["Segment<br>[1633, 1658, 0]"]
    65["Segment<br>[1664, 1720, 0]"]
    66["Segment<br>[1726, 1733, 0]"]
    67[Solid2d]
  end
  subgraph path68 [Path]
    68["Path<br>[1747, 1786, 0]"]
    69["Segment<br>[1792, 1815, 0]"]
    70["Segment<br>[1821, 1846, 0]"]
    71["Segment<br>[1852, 1908, 0]"]
    72["Segment<br>[1914, 1921, 0]"]
    73[Solid2d]
  end
  subgraph path74 [Path]
    74["Path<br>[1935, 1991, 0]"]
    75["Segment<br>[1935, 1991, 0]"]
    76[Solid2d]
  end
  subgraph path77 [Path]
    77["Path<br>[2005, 2045, 0]"]
    78["Segment<br>[2051, 2116, 0]"]
    79["Segment<br>[2122, 2190, 0]"]
    80["Segment<br>[2196, 2284, 0]"]
    81["Segment<br>[2290, 2346, 0]"]
    82["Segment<br>[2352, 2359, 0]"]
    83[Solid2d]
  end
  1["Plane<br>[12, 31, 0]"]
  8["Sweep Extrusion<br>[263, 295, 0]"]
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
  45["Sweep RevolveAboutEdge<br>[1287, 1353, 0]"]
  46["Sweep Extrusion<br>[1367, 1398, 0]"]
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
  58["Plane<br>[1411, 1431, 0]"]
  84["Sweep Extrusion<br>[2373, 2406, 0]"]
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
  99["Sweep RevolveAboutEdge<br>[2420, 2465, 0]"]
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
  111["StartSketchOnFace<br>[308, 347, 0]"]
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

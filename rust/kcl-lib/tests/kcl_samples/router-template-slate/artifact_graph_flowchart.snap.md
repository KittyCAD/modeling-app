```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[537, 580, 0]"]
    3["Segment<br>[586, 625, 0]"]
    4["Segment<br>[631, 729, 0]"]
    5["Segment<br>[735, 811, 0]"]
    6["Segment<br>[817, 886, 0]"]
    7["Segment<br>[892, 932, 0]"]
    8["Segment<br>[938, 974, 0]"]
    9["Segment<br>[1014, 1044, 0]"]
    10["Segment<br>[1050, 1079, 0]"]
    11["Segment<br>[1085, 1114, 0]"]
    12["Segment<br>[1120, 1149, 0]"]
    13["Segment<br>[1155, 1255, 0]"]
    14["Segment<br>[1261, 1317, 0]"]
    15["Segment<br>[1323, 1330, 0]"]
    16[Solid2d]
  end
  subgraph path52 [Path]
    52["Path<br>[1485, 1585, 0]"]
    53["Segment<br>[1591, 1638, 0]"]
    54["Segment<br>[1644, 1759, 0]"]
    55["Segment<br>[1765, 1885, 0]"]
    56["Segment<br>[1891, 1947, 0]"]
    57["Segment<br>[1953, 1960, 0]"]
    58[Solid2d]
  end
  subgraph path74 [Path]
    74["Path<br>[2117, 2216, 0]"]
    75["Segment<br>[2222, 2268, 0]"]
    76["Segment<br>[2274, 2366, 0]"]
    77["Segment<br>[2372, 2469, 0]"]
    78["Segment<br>[2475, 2531, 0]"]
    79["Segment<br>[2537, 2544, 0]"]
    80[Solid2d]
  end
  1["Plane<br>[514, 531, 0]"]
  17["Sweep Extrusion<br>[1373, 1403, 0]"]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27[Wall]
  28[Wall]
  29["Cap Start"]
  30["Cap End"]
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
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Opposite"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Opposite"]
  59["Sweep Extrusion<br>[2004, 2036, 0]"]
  60[Wall]
  61[Wall]
  62[Wall]
  63[Wall]
  64["Cap Start"]
  65["Cap End"]
  66["SweepEdge Opposite"]
  67["SweepEdge Adjacent"]
  68["SweepEdge Opposite"]
  69["SweepEdge Adjacent"]
  70["SweepEdge Opposite"]
  71["SweepEdge Adjacent"]
  72["SweepEdge Opposite"]
  73["SweepEdge Adjacent"]
  81["Sweep Extrusion<br>[2587, 2619, 0]"]
  82[Wall]
  83[Wall]
  84[Wall]
  85[Wall]
  86["Cap Start"]
  87["Cap End"]
  88["SweepEdge Opposite"]
  89["SweepEdge Adjacent"]
  90["SweepEdge Opposite"]
  91["SweepEdge Adjacent"]
  92["SweepEdge Opposite"]
  93["SweepEdge Adjacent"]
  94["SweepEdge Opposite"]
  95["SweepEdge Adjacent"]
  96["StartSketchOnFace<br>[1445, 1479, 0]"]
  97["StartSketchOnFace<br>[2077, 2111, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 --- 10
  2 --- 11
  2 --- 12
  2 --- 13
  2 --- 14
  2 --- 15
  2 ---- 17
  2 --- 16
  3 --- 28
  3 --- 51
  3 --- 32
  4 --- 27
  4 --- 49
  4 --- 50
  5 --- 26
  5 --- 47
  5 --- 48
  6 --- 25
  6 --- 45
  6 --- 46
  7 --- 24
  7 --- 43
  7 --- 44
  9 --- 23
  9 --- 41
  9 --- 42
  10 --- 22
  10 --- 39
  10 --- 40
  11 --- 21
  11 --- 37
  11 --- 38
  12 --- 20
  12 --- 35
  12 --- 36
  13 --- 19
  13 --- 33
  13 --- 34
  14 --- 18
  14 --- 31
  14 x--> 32
  17 --- 18
  17 --- 19
  17 --- 20
  17 --- 21
  17 --- 22
  17 --- 23
  17 --- 24
  17 --- 25
  17 --- 26
  17 --- 27
  17 --- 28
  17 --- 29
  17 --- 30
  17 --- 31
  17 --- 32
  17 --- 33
  17 --- 34
  17 --- 35
  17 --- 36
  17 --- 37
  17 --- 38
  17 --- 39
  17 --- 40
  17 --- 41
  17 --- 42
  17 --- 43
  17 --- 44
  17 --- 45
  17 --- 46
  17 --- 47
  17 --- 48
  17 --- 49
  17 --- 50
  17 --- 51
  29 --- 52
  29 --- 74
  52 --- 53
  52 --- 54
  52 --- 55
  52 --- 56
  52 --- 57
  52 ---- 59
  52 --- 58
  53 --- 60
  53 --- 66
  53 --- 67
  54 --- 61
  54 --- 68
  54 --- 69
  55 --- 62
  55 --- 70
  55 --- 71
  56 --- 63
  56 --- 72
  56 --- 73
  59 --- 60
  59 --- 61
  59 --- 62
  59 --- 63
  59 --- 64
  59 --- 65
  59 --- 66
  59 --- 67
  59 --- 68
  59 --- 69
  59 --- 70
  59 --- 71
  59 --- 72
  59 --- 73
  74 --- 75
  74 --- 76
  74 --- 77
  74 --- 78
  74 --- 79
  74 ---- 81
  74 --- 80
  75 --- 85
  75 --- 94
  75 --- 95
  76 --- 84
  76 --- 92
  76 --- 93
  77 --- 83
  77 --- 90
  77 --- 91
  78 --- 82
  78 --- 88
  78 --- 89
  81 --- 82
  81 --- 83
  81 --- 84
  81 --- 85
  81 --- 86
  81 --- 87
  81 --- 88
  81 --- 89
  81 --- 90
  81 --- 91
  81 --- 92
  81 --- 93
  81 --- 94
  81 --- 95
  29 <--x 96
  29 <--x 97
```

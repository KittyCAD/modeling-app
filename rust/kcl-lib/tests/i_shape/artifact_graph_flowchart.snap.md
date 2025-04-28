```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[422, 459, 0]"]
    5["Segment<br>[465, 505, 0]"]
    6["Segment<br>[511, 562, 0]"]
    7["Segment<br>[568, 604, 0]"]
    8["Segment<br>[610, 662, 0]"]
    9["Segment<br>[668, 733, 0]"]
    10["Segment<br>[739, 791, 0]"]
    11["Segment<br>[797, 855, 0]"]
    12["Segment<br>[861, 912, 0]"]
    13["Segment<br>[918, 960, 0]"]
    14["Segment<br>[966, 1017, 0]"]
    15["Segment<br>[1023, 1059, 0]"]
    16["Segment<br>[1065, 1117, 0]"]
    17["Segment<br>[1123, 1192, 0]"]
    18["Segment<br>[1198, 1251, 0]"]
    19["Segment<br>[1257, 1296, 0]"]
    20["Segment<br>[1302, 1354, 0]"]
    21["Segment<br>[1360, 1402, 0]"]
    22["Segment<br>[1408, 1460, 0]"]
    23["Segment<br>[1466, 1527, 0]"]
    24["Segment<br>[1533, 1586, 0]"]
    25["Segment<br>[1592, 1722, 0]"]
    26["Segment<br>[1728, 1781, 0]"]
    27["Segment<br>[1787, 1826, 0]"]
    28["Segment<br>[1832, 1884, 0]"]
    29["Segment<br>[1890, 1898, 0]"]
    39[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[1931, 1956, 0]"]
    30["Segment<br>[1962, 1981, 0]"]
    31["Segment<br>[1987, 2038, 0]"]
    32["Segment<br>[2044, 2086, 0]"]
    33["Segment<br>[2092, 2144, 0]"]
    34["Segment<br>[2150, 2170, 0]"]
    35["Segment<br>[2176, 2229, 0]"]
    36["Segment<br>[2235, 2280, 0]"]
    37["Segment<br>[2286, 2338, 0]"]
    38["Segment<br>[2344, 2352, 0]"]
    40[Solid2d]
  end
  1["Plane<br>[399, 416, 0]"]
  2["Plane<br>[1908, 1925, 0]"]
  41["Sweep Extrusion<br>[2408, 2429, 0]"]
  42[Wall]
  43[Wall]
  44[Wall]
  45[Wall]
  46[Wall]
  47[Wall]
  48[Wall]
  49[Wall]
  50[Wall]
  51[Wall]
  52[Wall]
  53[Wall]
  54[Wall]
  55[Wall]
  56[Wall]
  57[Wall]
  58[Wall]
  59[Wall]
  60[Wall]
  61[Wall]
  62[Wall]
  63[Wall]
  64[Wall]
  65[Wall]
  66["Cap Start"]
  67["Cap End"]
  68["SweepEdge Opposite"]
  69["SweepEdge Adjacent"]
  70["SweepEdge Opposite"]
  71["SweepEdge Adjacent"]
  72["SweepEdge Opposite"]
  73["SweepEdge Adjacent"]
  74["SweepEdge Opposite"]
  75["SweepEdge Adjacent"]
  76["SweepEdge Opposite"]
  77["SweepEdge Adjacent"]
  78["SweepEdge Opposite"]
  79["SweepEdge Adjacent"]
  80["SweepEdge Opposite"]
  81["SweepEdge Adjacent"]
  82["SweepEdge Opposite"]
  83["SweepEdge Adjacent"]
  84["SweepEdge Opposite"]
  85["SweepEdge Adjacent"]
  86["SweepEdge Opposite"]
  87["SweepEdge Adjacent"]
  88["SweepEdge Opposite"]
  89["SweepEdge Adjacent"]
  90["SweepEdge Opposite"]
  91["SweepEdge Adjacent"]
  92["SweepEdge Opposite"]
  93["SweepEdge Adjacent"]
  94["SweepEdge Opposite"]
  95["SweepEdge Adjacent"]
  96["SweepEdge Opposite"]
  97["SweepEdge Adjacent"]
  98["SweepEdge Opposite"]
  99["SweepEdge Adjacent"]
  100["SweepEdge Opposite"]
  101["SweepEdge Adjacent"]
  102["SweepEdge Opposite"]
  103["SweepEdge Adjacent"]
  104["SweepEdge Opposite"]
  105["SweepEdge Adjacent"]
  106["SweepEdge Opposite"]
  107["SweepEdge Adjacent"]
  108["SweepEdge Opposite"]
  109["SweepEdge Adjacent"]
  110["SweepEdge Opposite"]
  111["SweepEdge Adjacent"]
  112["SweepEdge Opposite"]
  113["SweepEdge Adjacent"]
  114["SweepEdge Opposite"]
  115["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 10
  3 --- 11
  3 --- 12
  3 --- 13
  3 --- 14
  3 --- 15
  3 --- 16
  3 --- 17
  3 --- 18
  3 --- 19
  3 --- 20
  3 --- 21
  3 --- 22
  3 --- 23
  3 --- 24
  3 --- 25
  3 --- 26
  3 --- 27
  3 --- 28
  3 --- 29
  3 --- 39
  3 ---- 41
  4 --- 30
  4 --- 31
  4 --- 32
  4 --- 33
  4 --- 34
  4 --- 35
  4 --- 36
  4 --- 37
  4 --- 38
  4 --- 40
  5 --- 61
  5 x--> 66
  5 --- 106
  5 --- 107
  6 --- 53
  6 x--> 66
  6 --- 90
  6 --- 91
  7 --- 52
  7 x--> 66
  7 --- 88
  7 --- 89
  8 --- 57
  8 x--> 66
  8 --- 98
  8 --- 99
  9 --- 48
  9 x--> 66
  9 --- 80
  9 --- 81
  10 --- 47
  10 x--> 66
  10 --- 78
  10 --- 79
  11 --- 60
  11 x--> 66
  11 --- 104
  11 --- 105
  12 --- 64
  12 x--> 66
  12 --- 112
  12 --- 113
  13 --- 63
  13 x--> 66
  13 --- 110
  13 --- 111
  14 --- 45
  14 x--> 66
  14 --- 74
  14 --- 75
  15 --- 46
  15 x--> 66
  15 --- 76
  15 --- 77
  16 --- 65
  16 x--> 66
  16 --- 114
  16 --- 115
  17 --- 58
  17 x--> 66
  17 --- 100
  17 --- 101
  18 --- 50
  18 x--> 66
  18 --- 84
  18 --- 85
  19 --- 43
  19 x--> 66
  19 --- 70
  19 --- 71
  20 --- 59
  20 x--> 66
  20 --- 102
  20 --- 103
  21 --- 44
  21 x--> 66
  21 --- 72
  21 --- 73
  22 --- 62
  22 x--> 66
  22 --- 108
  22 --- 109
  23 --- 42
  23 x--> 66
  23 --- 68
  23 --- 69
  24 --- 55
  24 x--> 66
  24 --- 94
  24 --- 95
  25 --- 56
  25 x--> 66
  25 --- 96
  25 --- 97
  26 --- 51
  26 x--> 66
  26 --- 86
  26 --- 87
  27 --- 54
  27 x--> 66
  27 --- 92
  27 --- 93
  28 --- 49
  28 x--> 66
  28 --- 82
  28 --- 83
  41 --- 42
  41 --- 43
  41 --- 44
  41 --- 45
  41 --- 46
  41 --- 47
  41 --- 48
  41 --- 49
  41 --- 50
  41 --- 51
  41 --- 52
  41 --- 53
  41 --- 54
  41 --- 55
  41 --- 56
  41 --- 57
  41 --- 58
  41 --- 59
  41 --- 60
  41 --- 61
  41 --- 62
  41 --- 63
  41 --- 64
  41 --- 65
  41 --- 66
  41 --- 67
  41 --- 68
  41 --- 69
  41 --- 70
  41 --- 71
  41 --- 72
  41 --- 73
  41 --- 74
  41 --- 75
  41 --- 76
  41 --- 77
  41 --- 78
  41 --- 79
  41 --- 80
  41 --- 81
  41 --- 82
  41 --- 83
  41 --- 84
  41 --- 85
  41 --- 86
  41 --- 87
  41 --- 88
  41 --- 89
  41 --- 90
  41 --- 91
  41 --- 92
  41 --- 93
  41 --- 94
  41 --- 95
  41 --- 96
  41 --- 97
  41 --- 98
  41 --- 99
  41 --- 100
  41 --- 101
  41 --- 102
  41 --- 103
  41 --- 104
  41 --- 105
  41 --- 106
  41 --- 107
  41 --- 108
  41 --- 109
  41 --- 110
  41 --- 111
  41 --- 112
  41 --- 113
  41 --- 114
  41 --- 115
  68 <--x 42
  69 <--x 42
  109 <--x 42
  70 <--x 43
  71 <--x 43
  85 <--x 43
  72 <--x 44
  73 <--x 44
  103 <--x 44
  74 <--x 45
  75 <--x 45
  111 <--x 45
  75 <--x 46
  76 <--x 46
  77 <--x 46
  78 <--x 47
  79 <--x 47
  81 <--x 47
  80 <--x 48
  81 <--x 48
  99 <--x 48
  82 <--x 49
  83 <--x 49
  93 <--x 49
  84 <--x 50
  85 <--x 50
  101 <--x 50
  86 <--x 51
  87 <--x 51
  97 <--x 51
  88 <--x 52
  89 <--x 52
  91 <--x 52
  90 <--x 53
  91 <--x 53
  107 <--x 53
  87 <--x 54
  92 <--x 54
  93 <--x 54
  69 <--x 55
  94 <--x 55
  95 <--x 55
  95 <--x 56
  96 <--x 56
  97 <--x 56
  89 <--x 57
  98 <--x 57
  99 <--x 57
  100 <--x 58
  101 <--x 58
  115 <--x 58
  71 <--x 59
  102 <--x 59
  103 <--x 59
  79 <--x 60
  104 <--x 60
  105 <--x 60
  83 <--x 61
  106 <--x 61
  107 <--x 61
  73 <--x 62
  108 <--x 62
  109 <--x 62
  110 <--x 63
  111 <--x 63
  113 <--x 63
  105 <--x 64
  112 <--x 64
  113 <--x 64
  77 <--x 65
  114 <--x 65
  115 <--x 65
  68 <--x 67
  70 <--x 67
  72 <--x 67
  74 <--x 67
  76 <--x 67
  78 <--x 67
  80 <--x 67
  82 <--x 67
  84 <--x 67
  86 <--x 67
  88 <--x 67
  90 <--x 67
  92 <--x 67
  94 <--x 67
  96 <--x 67
  98 <--x 67
  100 <--x 67
  102 <--x 67
  104 <--x 67
  106 <--x 67
  108 <--x 67
  110 <--x 67
  112 <--x 67
  114 <--x 67
```

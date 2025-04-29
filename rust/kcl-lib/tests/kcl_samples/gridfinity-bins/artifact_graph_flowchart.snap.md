```mermaid
flowchart LR
  subgraph path9 [Path]
    9["Path<br>[928, 974, 0]"]
    14["Segment<br>[982, 1004, 0]"]
    17["Segment<br>[1012, 1042, 0]"]
    18["Segment<br>[1050, 1094, 0]"]
    20["Segment<br>[1102, 1129, 0]"]
    22["Segment<br>[1137, 1181, 0]"]
    25["Segment<br>[1189, 1196, 0]"]
    35[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[928, 974, 0]"]
    15["Segment<br>[982, 1004, 0]"]
    16["Segment<br>[1012, 1042, 0]"]
    19["Segment<br>[1050, 1094, 0]"]
    21["Segment<br>[1102, 1129, 0]"]
    23["Segment<br>[1137, 1181, 0]"]
    24["Segment<br>[1189, 1196, 0]"]
    39[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[2237, 2325, 0]"]
    26["Segment<br>[2331, 2395, 0]"]
    27["Segment<br>[2401, 2465, 0]"]
    28["Segment<br>[2471, 2524, 0]"]
    29["Segment<br>[2530, 2551, 0]"]
    37[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[2882, 3048, 0]"]
    30["Segment<br>[2882, 3048, 0]"]
    36[Solid2d]
  end
  subgraph path13 [Path]
    13["Path<br>[4361, 4386, 0]"]
    31["Segment<br>[4392, 4464, 0]"]
    32["Segment<br>[4470, 4543, 0]"]
    33["Segment<br>[4549, 4602, 0]"]
    34["Segment<br>[4608, 4629, 0]"]
    38[Solid2d]
  end
  1["Plane<br>[1282, 1329, 0]"]
  2["Plane<br>[1861, 1908, 0]"]
  3["Plane<br>[2214, 2231, 0]"]
  4["Plane<br>[4322, 4354, 0]"]
  5["StartSketchOnPlane<br>[4308, 4355, 0]"]
  6["StartSketchOnPlane<br>[900, 920, 0]"]
  7["StartSketchOnPlane<br>[900, 920, 0]"]
  8["StartSketchOnFace<br>[2834, 2876, 0]"]
  40["Sweep Extrusion<br>[1269, 1372, 0]"]
  41["Sweep Revolve<br>[1848, 1939, 0]"]
  42["Sweep Extrusion<br>[2557, 2581, 0]"]
  43["Sweep Extrusion<br>[3270, 3297, 0]"]
  44["Sweep Extrusion<br>[3270, 3297, 0]"]
  45["Sweep Extrusion<br>[3270, 3297, 0]"]
  46["Sweep Extrusion<br>[3270, 3297, 0]"]
  47["Sweep Extrusion<br>[4635, 4679, 0]"]
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
  66[Wall]
  67["Cap Start"]
  68["Cap Start"]
  69["Cap Start"]
  70["Cap Start"]
  71["Cap Start"]
  72["Cap End"]
  73["Cap End"]
  74["Cap End"]
  75["Cap End"]
  76["SweepEdge Opposite"]
  77["SweepEdge Opposite"]
  78["SweepEdge Opposite"]
  79["SweepEdge Opposite"]
  80["SweepEdge Opposite"]
  81["SweepEdge Opposite"]
  82["SweepEdge Opposite"]
  83["SweepEdge Opposite"]
  84["SweepEdge Opposite"]
  85["SweepEdge Opposite"]
  86["SweepEdge Opposite"]
  87["SweepEdge Opposite"]
  88["SweepEdge Opposite"]
  89["SweepEdge Opposite"]
  90["SweepEdge Opposite"]
  91["SweepEdge Opposite"]
  92["SweepEdge Opposite"]
  93["SweepEdge Opposite"]
  94["SweepEdge Opposite"]
  95["SweepEdge Adjacent"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Adjacent"]
  98["SweepEdge Adjacent"]
  99["SweepEdge Adjacent"]
  100["SweepEdge Adjacent"]
  101["SweepEdge Adjacent"]
  102["SweepEdge Adjacent"]
  103["SweepEdge Adjacent"]
  104["SweepEdge Adjacent"]
  105["SweepEdge Adjacent"]
  106["SweepEdge Adjacent"]
  107["SweepEdge Adjacent"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Adjacent"]
  110["SweepEdge Adjacent"]
  111["SweepEdge Adjacent"]
  112["SweepEdge Adjacent"]
  113["SweepEdge Adjacent"]
  114["EdgeCut Fillet<br>[2587, 2817, 0]"]
  115["EdgeCut Fillet<br>[2587, 2817, 0]"]
  116["EdgeCut Fillet<br>[2587, 2817, 0]"]
  117["EdgeCut Fillet<br>[2587, 2817, 0]"]
  118["EdgeCut Fillet<br>[4685, 4918, 0]"]
  119["EdgeCut Fillet<br>[4685, 4918, 0]"]
  120["EdgeCut Fillet<br>[4685, 4918, 0]"]
  121["EdgeCut Fillet<br>[4685, 4918, 0]"]
  1 <--x 7
  1 --- 10
  2 <--x 6
  2 --- 9
  3 --- 11
  4 <--x 5
  4 --- 13
  68 x--> 8
  9 --- 14
  9 --- 17
  9 --- 18
  9 --- 20
  9 --- 22
  9 --- 25
  9 --- 35
  9 ---- 41
  10 --- 15
  10 --- 16
  10 --- 19
  10 --- 21
  10 --- 23
  10 --- 24
  10 --- 39
  10 ---- 40
  11 --- 26
  11 --- 27
  11 --- 28
  11 --- 29
  11 --- 37
  11 ---- 42
  12 --- 30
  12 --- 36
  12 ---- 45
  68 --- 12
  13 --- 31
  13 --- 32
  13 --- 33
  13 --- 34
  13 --- 38
  13 ---- 47
  14 --- 57
  14 x--> 69
  14 --- 89
  14 --- 108
  15 --- 49
  15 x--> 67
  15 --- 80
  15 --- 96
  16 --- 48
  16 x--> 67
  16 --- 78
  16 --- 98
  17 --- 58
  17 x--> 69
  17 --- 86
  17 --- 106
  18 --- 60
  18 x--> 69
  18 --- 88
  18 --- 107
  19 --- 50
  19 x--> 67
  19 --- 76
  19 --- 95
  20 --- 61
  20 x--> 69
  20 --- 85
  20 --- 104
  21 --- 52
  21 x--> 67
  21 --- 77
  21 --- 97
  22 --- 59
  22 x--> 69
  22 --- 87
  22 --- 105
  23 --- 51
  23 x--> 67
  23 --- 79
  23 --- 99
  26 --- 54
  26 x--> 68
  26 --- 82
  26 --- 102
  27 --- 55
  27 x--> 68
  27 --- 84
  27 --- 100
  28 --- 53
  28 x--> 68
  28 --- 81
  28 --- 101
  29 --- 56
  29 x--> 68
  29 --- 83
  29 --- 103
  30 --- 66
  30 x--> 68
  30 --- 94
  30 --- 113
  31 --- 63
  31 x--> 70
  31 --- 90
  31 --- 111
  32 --- 62
  32 x--> 70
  32 --- 93
  32 --- 110
  33 --- 65
  33 x--> 70
  33 --- 92
  33 --- 112
  34 --- 64
  34 x--> 70
  34 --- 91
  34 --- 109
  40 --- 48
  40 --- 49
  40 --- 50
  40 --- 51
  40 --- 52
  40 --- 67
  40 --- 72
  40 --- 76
  40 --- 77
  40 --- 78
  40 --- 79
  40 --- 80
  40 --- 95
  40 --- 96
  40 --- 97
  40 --- 98
  40 --- 99
  41 --- 57
  41 --- 58
  41 --- 59
  41 --- 60
  41 --- 61
  41 --- 69
  41 --- 74
  41 --- 85
  41 --- 86
  41 --- 87
  41 --- 88
  41 --- 89
  41 --- 104
  41 --- 105
  41 --- 106
  41 --- 107
  41 --- 108
  42 --- 53
  42 --- 54
  42 --- 55
  42 --- 56
  42 --- 68
  42 --- 73
  42 --- 81
  42 --- 82
  42 --- 83
  42 --- 84
  42 --- 100
  42 --- 101
  42 --- 102
  42 --- 103
  45 --- 66
  45 --- 71
  45 --- 94
  45 --- 113
  47 --- 62
  47 --- 63
  47 --- 64
  47 --- 65
  47 --- 70
  47 --- 75
  47 --- 90
  47 --- 91
  47 --- 92
  47 --- 93
  47 --- 109
  47 --- 110
  47 --- 111
  47 --- 112
  78 <--x 48
  96 <--x 48
  98 <--x 48
  80 <--x 49
  96 <--x 49
  99 <--x 49
  76 <--x 50
  95 <--x 50
  98 <--x 50
  79 <--x 51
  97 <--x 51
  99 <--x 51
  77 <--x 52
  95 <--x 52
  97 <--x 52
  81 <--x 53
  100 <--x 53
  82 <--x 54
  103 <--x 54
  84 <--x 55
  100 <--x 55
  83 <--x 56
  103 <--x 56
  89 <--x 57
  105 <--x 57
  108 <--x 57
  86 <--x 58
  106 <--x 58
  108 <--x 58
  87 <--x 59
  104 <--x 59
  105 <--x 59
  88 <--x 60
  106 <--x 60
  107 <--x 60
  85 <--x 61
  104 <--x 61
  107 <--x 61
  93 <--x 62
  110 <--x 62
  90 <--x 63
  109 <--x 63
  91 <--x 64
  109 <--x 64
  92 <--x 65
  110 <--x 65
  94 <--x 66
  113 <--x 66
  94 <--x 71
  76 <--x 72
  77 <--x 72
  78 <--x 72
  79 <--x 72
  80 <--x 72
  81 <--x 73
  82 <--x 73
  83 <--x 73
  84 <--x 73
  85 <--x 74
  86 <--x 74
  87 <--x 74
  88 <--x 74
  89 <--x 74
  90 <--x 75
  91 <--x 75
  92 <--x 75
  93 <--x 75
  100 <--x 117
  101 <--x 116
  102 <--x 114
  103 <--x 115
  109 <--x 119
  110 <--x 121
  111 <--x 118
  112 <--x 120
```

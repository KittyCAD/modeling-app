```mermaid
flowchart LR
  subgraph path6 [Path]
    6["Path<br>[1234, 1272, 0]"]
    13["Segment<br>[1280, 1330, 0]"]
    14["Segment<br>[1338, 1387, 0]"]
    15["Segment<br>[1395, 1447, 0]"]
    16["Segment<br>[1455, 1503, 0]"]
    17["Segment<br>[1511, 1555, 0]"]
    18["Segment<br>[1563, 1608, 0]"]
    19["Segment<br>[1616, 1665, 0]"]
    20["Segment<br>[1673, 1692, 0]"]
    43[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[2383, 2437, 0]"]
    21["Segment<br>[2443, 2496, 0]"]
    22["Segment<br>[2502, 2552, 0]"]
    23["Segment<br>[2558, 2612, 0]"]
    24["Segment<br>[2618, 2638, 0]"]
    42[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[2662, 2825, 0]"]
    25["Segment<br>[2662, 2825, 0]"]
    39[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[3207, 3262, 0]"]
    26["Segment<br>[3268, 3322, 0]"]
    27["Segment<br>[3328, 3378, 0]"]
    28["Segment<br>[3384, 3437, 0]"]
    29["Segment<br>[3443, 3463, 0]"]
    38[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[3487, 3653, 0]"]
    30["Segment<br>[3487, 3653, 0]"]
    40[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[4233, 4274, 0]"]
    31["Segment<br>[4280, 4300, 0]"]
    32["Segment<br>[4306, 4329, 0]"]
    33["Segment<br>[4335, 4342, 0]"]
    44[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[4457, 4497, 0]"]
    34["Segment<br>[4503, 4523, 0]"]
    35["Segment<br>[4529, 4550, 0]"]
    36["Segment<br>[4556, 4577, 0]"]
    37["Segment<br>[4583, 4590, 0]"]
    41[Solid2d]
  end
  1["Plane<br>[1199, 1226, 0]"]
  2["Plane<br>[2354, 2377, 0]"]
  3["Plane<br>[3178, 3201, 0]"]
  4["Plane<br>[4204, 4227, 0]"]
  5["Plane<br>[4428, 4451, 0]"]
  45["Sweep Extrusion<br>[1800, 1834, 0]"]
  46["Sweep Extrusion<br>[2832, 2857, 0]"]
  47["Sweep Extrusion<br>[3660, 3685, 0]"]
  48["Sweep Extrusion<br>[4348, 4376, 0]"]
  49["Sweep Extrusion<br>[4596, 4624, 0]"]
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
  67[Wall]
  68[Wall]
  69[Wall]
  70[Wall]
  71[Wall]
  72[Wall]
  73["Cap Start"]
  74["Cap End"]
  75["Cap Start"]
  76["Cap End"]
  77["Cap Start"]
  78["Cap End"]
  79["Cap Start"]
  80["Cap End"]
  81["Cap Start"]
  82["Cap End"]
  83["SweepEdge Opposite"]
  84["SweepEdge Adjacent"]
  85["SweepEdge Opposite"]
  86["SweepEdge Adjacent"]
  87["SweepEdge Opposite"]
  88["SweepEdge Adjacent"]
  89["SweepEdge Opposite"]
  90["SweepEdge Adjacent"]
  91["SweepEdge Opposite"]
  92["SweepEdge Adjacent"]
  93["SweepEdge Opposite"]
  94["SweepEdge Adjacent"]
  95["SweepEdge Opposite"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Opposite"]
  98["SweepEdge Adjacent"]
  99["SweepEdge Opposite"]
  100["SweepEdge Adjacent"]
  101["SweepEdge Opposite"]
  102["SweepEdge Adjacent"]
  103["SweepEdge Opposite"]
  104["SweepEdge Adjacent"]
  105["SweepEdge Opposite"]
  106["SweepEdge Adjacent"]
  107["SweepEdge Opposite"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Opposite"]
  110["SweepEdge Adjacent"]
  111["SweepEdge Opposite"]
  112["SweepEdge Adjacent"]
  113["SweepEdge Opposite"]
  114["SweepEdge Adjacent"]
  115["SweepEdge Opposite"]
  116["SweepEdge Adjacent"]
  117["SweepEdge Opposite"]
  118["SweepEdge Adjacent"]
  119["SweepEdge Opposite"]
  120["SweepEdge Adjacent"]
  121["SweepEdge Opposite"]
  122["SweepEdge Adjacent"]
  123["SweepEdge Opposite"]
  124["SweepEdge Adjacent"]
  125["SweepEdge Opposite"]
  126["SweepEdge Adjacent"]
  127["SweepEdge Opposite"]
  128["SweepEdge Adjacent"]
  129["EdgeCut Fillet<br>[2863, 3008, 0]"]
  130["EdgeCut Fillet<br>[2863, 3008, 0]"]
  131["EdgeCut Fillet<br>[3691, 3836, 0]"]
  132["EdgeCut Fillet<br>[3691, 3836, 0]"]
  133["EdgeCut Fillet<br>[1840, 2099, 0]"]
  134["EdgeCut Fillet<br>[1840, 2099, 0]"]
  135["EdgeCut Fillet<br>[1840, 2099, 0]"]
  136["EdgeCut Fillet<br>[1840, 2099, 0]"]
  1 --- 6
  2 --- 7
  2 --- 8
  3 --- 9
  3 --- 10
  4 --- 11
  5 --- 12
  6 --- 13
  6 --- 14
  6 --- 15
  6 --- 16
  6 --- 17
  6 --- 18
  6 --- 19
  6 --- 20
  6 --- 43
  6 ---- 45
  7 --- 21
  7 --- 22
  7 --- 23
  7 --- 24
  7 --- 42
  7 ---- 46
  8 --- 25
  8 --- 39
  9 --- 26
  9 --- 27
  9 --- 28
  9 --- 29
  9 --- 38
  9 ---- 47
  10 --- 30
  10 --- 40
  11 --- 31
  11 --- 32
  11 --- 33
  11 --- 44
  11 ---- 48
  12 --- 34
  12 --- 35
  12 --- 36
  12 --- 37
  12 --- 41
  12 ---- 49
  13 --- 69
  13 x--> 81
  13 --- 121
  13 --- 122
  14 --- 68
  14 x--> 81
  14 --- 119
  14 --- 120
  15 --- 67
  15 x--> 81
  15 --- 117
  15 --- 118
  16 --- 70
  16 x--> 81
  16 --- 123
  16 --- 124
  17 --- 72
  17 x--> 81
  17 --- 127
  17 --- 128
  18 --- 71
  18 x--> 81
  18 --- 125
  18 --- 126
  19 --- 65
  19 x--> 81
  19 --- 113
  19 --- 114
  20 --- 66
  20 x--> 81
  20 --- 115
  20 --- 116
  21 --- 53
  21 x--> 74
  21 --- 89
  21 --- 90
  22 --- 50
  22 x--> 74
  22 --- 83
  22 --- 84
  23 --- 51
  23 x--> 74
  23 --- 85
  23 --- 86
  24 --- 52
  24 x--> 74
  24 --- 87
  24 --- 88
  26 --- 62
  26 x--> 80
  26 --- 107
  26 --- 108
  27 --- 63
  27 x--> 80
  27 --- 109
  27 --- 110
  28 --- 61
  28 x--> 80
  28 --- 105
  28 --- 106
  29 --- 64
  29 x--> 80
  29 --- 111
  29 --- 112
  31 --- 58
  31 x--> 77
  31 --- 99
  31 --- 100
  32 --- 60
  32 x--> 77
  32 --- 103
  32 --- 104
  33 --- 59
  33 x--> 77
  33 --- 101
  33 --- 102
  34 --- 56
  34 x--> 75
  34 --- 95
  34 --- 96
  35 --- 55
  35 x--> 75
  35 --- 93
  35 --- 94
  36 --- 54
  36 x--> 75
  36 --- 91
  36 --- 92
  37 --- 57
  37 x--> 75
  37 --- 97
  37 --- 98
  45 --- 65
  45 --- 66
  45 --- 67
  45 --- 68
  45 --- 69
  45 --- 70
  45 --- 71
  45 --- 72
  45 --- 81
  45 --- 82
  45 --- 113
  45 --- 114
  45 --- 115
  45 --- 116
  45 --- 117
  45 --- 118
  45 --- 119
  45 --- 120
  45 --- 121
  45 --- 122
  45 --- 123
  45 --- 124
  45 --- 125
  45 --- 126
  45 --- 127
  45 --- 128
  46 --- 50
  46 --- 51
  46 --- 52
  46 --- 53
  46 --- 73
  46 --- 74
  46 --- 83
  46 --- 84
  46 --- 85
  46 --- 86
  46 --- 87
  46 --- 88
  46 --- 89
  46 --- 90
  47 --- 61
  47 --- 62
  47 --- 63
  47 --- 64
  47 --- 79
  47 --- 80
  47 --- 105
  47 --- 106
  47 --- 107
  47 --- 108
  47 --- 109
  47 --- 110
  47 --- 111
  47 --- 112
  48 --- 58
  48 --- 59
  48 --- 60
  48 --- 77
  48 --- 78
  48 --- 99
  48 --- 100
  48 --- 101
  48 --- 102
  48 --- 103
  48 --- 104
  49 --- 54
  49 --- 55
  49 --- 56
  49 --- 57
  49 --- 75
  49 --- 76
  49 --- 91
  49 --- 92
  49 --- 93
  49 --- 94
  49 --- 95
  49 --- 96
  49 --- 97
  49 --- 98
  83 <--x 50
  90 <--x 50
  85 <--x 51
  86 <--x 51
  86 <--x 52
  87 <--x 52
  88 <--x 52
  88 <--x 53
  89 <--x 53
  90 <--x 53
  91 <--x 54
  92 <--x 54
  94 <--x 54
  93 <--x 55
  94 <--x 55
  96 <--x 55
  95 <--x 56
  96 <--x 56
  98 <--x 56
  92 <--x 57
  97 <--x 57
  98 <--x 57
  99 <--x 58
  100 <--x 58
  102 <--x 58
  101 <--x 59
  102 <--x 59
  104 <--x 59
  100 <--x 60
  103 <--x 60
  104 <--x 60
  105 <--x 61
  106 <--x 61
  107 <--x 62
  108 <--x 62
  112 <--x 62
  108 <--x 63
  109 <--x 63
  106 <--x 64
  111 <--x 64
  112 <--x 64
  113 <--x 65
  114 <--x 65
  126 <--x 65
  114 <--x 66
  115 <--x 66
  116 <--x 66
  117 <--x 67
  118 <--x 67
  120 <--x 67
  119 <--x 68
  120 <--x 68
  122 <--x 68
  116 <--x 69
  121 <--x 69
  122 <--x 69
  118 <--x 70
  123 <--x 70
  124 <--x 70
  125 <--x 71
  126 <--x 71
  128 <--x 71
  124 <--x 72
  127 <--x 72
  128 <--x 72
  83 <--x 73
  85 <--x 73
  87 <--x 73
  89 <--x 73
  91 <--x 76
  93 <--x 76
  95 <--x 76
  97 <--x 76
  99 <--x 78
  101 <--x 78
  103 <--x 78
  105 <--x 79
  107 <--x 79
  109 <--x 79
  111 <--x 79
  113 <--x 82
  115 <--x 82
  117 <--x 82
  119 <--x 82
  121 <--x 82
  123 <--x 82
  125 <--x 82
  127 <--x 82
  84 <--x 130
  90 <--x 129
  108 <--x 131
  110 <--x 132
  120 <--x 135
  122 <--x 134
  126 <--x 133
  128 <--x 136
```

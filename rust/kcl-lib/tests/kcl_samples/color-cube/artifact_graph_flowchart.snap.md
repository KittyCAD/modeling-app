```mermaid
flowchart LR
  subgraph path7 [Path]
    7["Path<br>[773, 813, 0]"]
    17["Segment<br>[821, 886, 0]"]
    24["Segment<br>[894, 991, 0]"]
    28["Segment<br>[999, 1116, 0]"]
    33["Segment<br>[1124, 1180, 0]"]
    37["Segment<br>[1188, 1195, 0]"]
    43[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[773, 813, 0]"]
    14["Segment<br>[821, 886, 0]"]
    22["Segment<br>[894, 991, 0]"]
    25["Segment<br>[999, 1116, 0]"]
    34["Segment<br>[1124, 1180, 0]"]
    39["Segment<br>[1188, 1195, 0]"]
    44[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[773, 813, 0]"]
    16["Segment<br>[821, 886, 0]"]
    21["Segment<br>[894, 991, 0]"]
    27["Segment<br>[999, 1116, 0]"]
    31["Segment<br>[1124, 1180, 0]"]
    41["Segment<br>[1188, 1195, 0]"]
    45[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[773, 813, 0]"]
    13["Segment<br>[821, 886, 0]"]
    19["Segment<br>[894, 991, 0]"]
    30["Segment<br>[999, 1116, 0]"]
    32["Segment<br>[1124, 1180, 0]"]
    42["Segment<br>[1188, 1195, 0]"]
    46[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[773, 813, 0]"]
    15["Segment<br>[821, 886, 0]"]
    23["Segment<br>[894, 991, 0]"]
    26["Segment<br>[999, 1116, 0]"]
    36["Segment<br>[1124, 1180, 0]"]
    38["Segment<br>[1188, 1195, 0]"]
    47[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[773, 813, 0]"]
    18["Segment<br>[821, 886, 0]"]
    20["Segment<br>[894, 991, 0]"]
    29["Segment<br>[999, 1116, 0]"]
    35["Segment<br>[1124, 1180, 0]"]
    40["Segment<br>[1188, 1195, 0]"]
    48[Solid2d]
  end
  1["Plane<br>[356, 390, 0]"]
  2["Plane<br>[405, 440, 0]"]
  3["Plane<br>[454, 489, 0]"]
  4["Plane<br>[504, 540, 0]"]
  5["Plane<br>[552, 602, 0]"]
  6["Plane<br>[615, 650, 0]"]
  49["Sweep Extrusion<br>[1203, 1234, 0]"]
  50["Sweep Extrusion<br>[1203, 1234, 0]"]
  51["Sweep Extrusion<br>[1203, 1234, 0]"]
  52["Sweep Extrusion<br>[1203, 1234, 0]"]
  53["Sweep Extrusion<br>[1203, 1234, 0]"]
  54["Sweep Extrusion<br>[1203, 1234, 0]"]
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
  73[Wall]
  74[Wall]
  75[Wall]
  76[Wall]
  77[Wall]
  78[Wall]
  79["Cap Start"]
  80["Cap Start"]
  81["Cap Start"]
  82["Cap Start"]
  83["Cap Start"]
  84["Cap Start"]
  85["Cap End"]
  86["Cap End"]
  87["Cap End"]
  88["Cap End"]
  89["Cap End"]
  90["Cap End"]
  91["SweepEdge Opposite"]
  92["SweepEdge Opposite"]
  93["SweepEdge Opposite"]
  94["SweepEdge Opposite"]
  95["SweepEdge Opposite"]
  96["SweepEdge Opposite"]
  97["SweepEdge Opposite"]
  98["SweepEdge Opposite"]
  99["SweepEdge Opposite"]
  100["SweepEdge Opposite"]
  101["SweepEdge Opposite"]
  102["SweepEdge Opposite"]
  103["SweepEdge Opposite"]
  104["SweepEdge Opposite"]
  105["SweepEdge Opposite"]
  106["SweepEdge Opposite"]
  107["SweepEdge Opposite"]
  108["SweepEdge Opposite"]
  109["SweepEdge Opposite"]
  110["SweepEdge Opposite"]
  111["SweepEdge Opposite"]
  112["SweepEdge Opposite"]
  113["SweepEdge Opposite"]
  114["SweepEdge Opposite"]
  115["SweepEdge Adjacent"]
  116["SweepEdge Adjacent"]
  117["SweepEdge Adjacent"]
  118["SweepEdge Adjacent"]
  119["SweepEdge Adjacent"]
  120["SweepEdge Adjacent"]
  121["SweepEdge Adjacent"]
  122["SweepEdge Adjacent"]
  123["SweepEdge Adjacent"]
  124["SweepEdge Adjacent"]
  125["SweepEdge Adjacent"]
  126["SweepEdge Adjacent"]
  127["SweepEdge Adjacent"]
  128["SweepEdge Adjacent"]
  129["SweepEdge Adjacent"]
  130["SweepEdge Adjacent"]
  131["SweepEdge Adjacent"]
  132["SweepEdge Adjacent"]
  133["SweepEdge Adjacent"]
  134["SweepEdge Adjacent"]
  135["SweepEdge Adjacent"]
  136["SweepEdge Adjacent"]
  137["SweepEdge Adjacent"]
  138["SweepEdge Adjacent"]
  1 --- 7
  2 --- 12
  3 --- 10
  4 --- 9
  5 --- 8
  6 --- 11
  7 --- 17
  7 --- 24
  7 --- 28
  7 --- 33
  7 --- 37
  7 --- 43
  7 ---- 52
  8 --- 14
  8 --- 22
  8 --- 25
  8 --- 34
  8 --- 39
  8 --- 44
  8 ---- 51
  9 --- 16
  9 --- 21
  9 --- 27
  9 --- 31
  9 --- 41
  9 --- 45
  9 ---- 49
  10 --- 13
  10 --- 19
  10 --- 30
  10 --- 32
  10 --- 42
  10 --- 46
  10 ---- 54
  11 --- 15
  11 --- 23
  11 --- 26
  11 --- 36
  11 --- 38
  11 --- 47
  11 ---- 50
  12 --- 18
  12 --- 20
  12 --- 29
  12 --- 35
  12 --- 40
  12 --- 48
  12 ---- 53
  13 --- 76
  13 x--> 84
  13 --- 114
  13 --- 135
  14 --- 64
  14 x--> 81
  14 --- 101
  14 --- 125
  15 --- 60
  15 x--> 80
  15 --- 96
  15 --- 120
  16 --- 57
  16 x--> 79
  16 --- 94
  16 --- 117
  17 --- 69
  17 x--> 82
  17 --- 103
  17 --- 129
  18 --- 72
  18 x--> 83
  18 --- 108
  18 --- 131
  19 --- 75
  19 x--> 84
  19 --- 112
  19 --- 137
  20 --- 71
  20 x--> 83
  20 --- 107
  20 --- 133
  21 --- 58
  21 x--> 79
  21 --- 91
  21 --- 115
  22 --- 65
  22 x--> 81
  22 --- 100
  22 --- 126
  23 --- 61
  23 x--> 80
  23 --- 98
  23 --- 119
  24 --- 70
  24 x--> 82
  24 --- 106
  24 --- 130
  25 --- 63
  25 x--> 81
  25 --- 102
  25 --- 123
  26 --- 59
  26 x--> 80
  26 --- 95
  26 --- 122
  27 --- 56
  27 x--> 79
  27 --- 92
  27 --- 116
  28 --- 67
  28 x--> 82
  28 --- 105
  28 --- 128
  29 --- 73
  29 x--> 83
  29 --- 110
  29 --- 134
  30 --- 78
  30 x--> 84
  30 --- 113
  30 --- 138
  31 --- 55
  31 x--> 79
  31 --- 93
  31 --- 118
  32 --- 77
  32 x--> 84
  32 --- 111
  32 --- 136
  33 --- 68
  33 x--> 82
  33 --- 104
  33 --- 127
  34 --- 66
  34 x--> 81
  34 --- 99
  34 --- 124
  35 --- 74
  35 x--> 83
  35 --- 109
  35 --- 132
  36 --- 62
  36 x--> 80
  36 --- 97
  36 --- 121
  49 --- 55
  49 --- 56
  49 --- 57
  49 --- 58
  49 --- 79
  49 --- 85
  49 --- 91
  49 --- 92
  49 --- 93
  49 --- 94
  49 --- 115
  49 --- 116
  49 --- 117
  49 --- 118
  50 --- 59
  50 --- 60
  50 --- 61
  50 --- 62
  50 --- 80
  50 --- 86
  50 --- 95
  50 --- 96
  50 --- 97
  50 --- 98
  50 --- 119
  50 --- 120
  50 --- 121
  50 --- 122
  51 --- 63
  51 --- 64
  51 --- 65
  51 --- 66
  51 --- 81
  51 --- 87
  51 --- 99
  51 --- 100
  51 --- 101
  51 --- 102
  51 --- 123
  51 --- 124
  51 --- 125
  51 --- 126
  52 --- 67
  52 --- 68
  52 --- 69
  52 --- 70
  52 --- 82
  52 --- 88
  52 --- 103
  52 --- 104
  52 --- 105
  52 --- 106
  52 --- 127
  52 --- 128
  52 --- 129
  52 --- 130
  53 --- 71
  53 --- 72
  53 --- 73
  53 --- 74
  53 --- 83
  53 --- 89
  53 --- 107
  53 --- 108
  53 --- 109
  53 --- 110
  53 --- 131
  53 --- 132
  53 --- 133
  53 --- 134
  54 --- 75
  54 --- 76
  54 --- 77
  54 --- 78
  54 --- 84
  54 --- 90
  54 --- 111
  54 --- 112
  54 --- 113
  54 --- 114
  54 --- 135
  54 --- 136
  54 --- 137
  54 --- 138
  93 <--x 55
  116 <--x 55
  118 <--x 55
  92 <--x 56
  115 <--x 56
  116 <--x 56
  94 <--x 57
  117 <--x 57
  118 <--x 57
  91 <--x 58
  115 <--x 58
  117 <--x 58
  95 <--x 59
  119 <--x 59
  122 <--x 59
  96 <--x 60
  120 <--x 60
  121 <--x 60
  98 <--x 61
  119 <--x 61
  120 <--x 61
  97 <--x 62
  121 <--x 62
  122 <--x 62
  102 <--x 63
  123 <--x 63
  126 <--x 63
  101 <--x 64
  124 <--x 64
  125 <--x 64
  100 <--x 65
  125 <--x 65
  126 <--x 65
  99 <--x 66
  123 <--x 66
  124 <--x 66
  105 <--x 67
  128 <--x 67
  130 <--x 67
  104 <--x 68
  127 <--x 68
  128 <--x 68
  103 <--x 69
  127 <--x 69
  129 <--x 69
  106 <--x 70
  129 <--x 70
  130 <--x 70
  107 <--x 71
  131 <--x 71
  133 <--x 71
  108 <--x 72
  131 <--x 72
  132 <--x 72
  110 <--x 73
  133 <--x 73
  134 <--x 73
  109 <--x 74
  132 <--x 74
  134 <--x 74
  112 <--x 75
  135 <--x 75
  137 <--x 75
  114 <--x 76
  135 <--x 76
  136 <--x 76
  111 <--x 77
  136 <--x 77
  138 <--x 77
  113 <--x 78
  137 <--x 78
  138 <--x 78
  91 <--x 85
  92 <--x 85
  93 <--x 85
  94 <--x 85
  95 <--x 86
  96 <--x 86
  97 <--x 86
  98 <--x 86
  99 <--x 87
  100 <--x 87
  101 <--x 87
  102 <--x 87
  103 <--x 88
  104 <--x 88
  105 <--x 88
  106 <--x 88
  107 <--x 89
  108 <--x 89
  109 <--x 89
  110 <--x 89
  111 <--x 90
  112 <--x 90
  113 <--x 90
  114 <--x 90
```

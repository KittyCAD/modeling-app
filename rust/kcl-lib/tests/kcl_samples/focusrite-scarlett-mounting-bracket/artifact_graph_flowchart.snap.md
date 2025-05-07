```mermaid
flowchart LR
  subgraph path6 [Path]
    6["Path<br>[831, 869, 0]"]
    13["Segment<br>[877, 927, 0]"]
    14["Segment<br>[935, 984, 0]"]
    15["Segment<br>[992, 1044, 0]"]
    16["Segment<br>[1052, 1100, 0]"]
    17["Segment<br>[1108, 1152, 0]"]
    18["Segment<br>[1160, 1205, 0]"]
    19["Segment<br>[1213, 1262, 0]"]
    20["Segment<br>[1270, 1289, 0]"]
    42[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[1992, 2046, 0]"]
    21["Segment<br>[2052, 2105, 0]"]
    22["Segment<br>[2111, 2161, 0]"]
    23["Segment<br>[2167, 2221, 0]"]
    24["Segment<br>[2227, 2247, 0]"]
    38[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[2271, 2434, 0]"]
    25["Segment<br>[2271, 2434, 0]"]
    40[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[2816, 2871, 0]"]
    26["Segment<br>[2877, 2931, 0]"]
    27["Segment<br>[2937, 2987, 0]"]
    28["Segment<br>[2993, 3046, 0]"]
    29["Segment<br>[3052, 3072, 0]"]
    39[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[3096, 3262, 0]"]
    30["Segment<br>[3096, 3262, 0]"]
    43[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[3842, 3883, 0]"]
    31["Segment<br>[3889, 3909, 0]"]
    32["Segment<br>[3915, 3938, 0]"]
    33["Segment<br>[3944, 3951, 0]"]
    41[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[4066, 4106, 0]"]
    34["Segment<br>[4112, 4132, 0]"]
    35["Segment<br>[4138, 4159, 0]"]
    36["Segment<br>[4165, 4186, 0]"]
    37["Segment<br>[4192, 4199, 0]"]
    44[Solid2d]
  end
  1["Plane<br>[796, 823, 0]"]
  2["Plane<br>[1963, 1986, 0]"]
  3["Plane<br>[2787, 2810, 0]"]
  4["Plane<br>[3813, 3836, 0]"]
  5["Plane<br>[4037, 4060, 0]"]
  45["Sweep Extrusion<br>[1409, 1443, 0]"]
  46["Sweep Extrusion<br>[2441, 2466, 0]"]
  47["Sweep Extrusion<br>[3269, 3294, 0]"]
  48["Sweep Extrusion<br>[3957, 3985, 0]"]
  49["Sweep Extrusion<br>[4205, 4233, 0]"]
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
  74["Cap Start"]
  75["Cap Start"]
  76["Cap Start"]
  77["Cap Start"]
  78["Cap End"]
  79["Cap End"]
  80["Cap End"]
  81["Cap End"]
  82["Cap End"]
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
  106["SweepEdge Adjacent"]
  107["SweepEdge Adjacent"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Adjacent"]
  110["SweepEdge Adjacent"]
  111["SweepEdge Adjacent"]
  112["SweepEdge Adjacent"]
  113["SweepEdge Adjacent"]
  114["SweepEdge Adjacent"]
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
  129["EdgeCut Fillet<br>[1449, 1708, 0]"]
  130["EdgeCut Fillet<br>[2472, 2617, 0]"]
  131["EdgeCut Fillet<br>[3300, 3445, 0]"]
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
  6 --- 42
  6 ---- 45
  7 --- 21
  7 --- 22
  7 --- 23
  7 --- 24
  7 --- 38
  7 ---- 46
  8 --- 25
  8 --- 40
  9 --- 26
  9 --- 27
  9 --- 28
  9 --- 29
  9 --- 39
  9 ---- 47
  10 --- 30
  10 --- 43
  11 --- 31
  11 --- 32
  11 --- 33
  11 --- 41
  11 ---- 48
  12 --- 34
  12 --- 35
  12 --- 36
  12 --- 37
  12 --- 44
  12 ---- 49
  13 --- 53
  13 x--> 73
  13 --- 88
  13 --- 107
  14 --- 54
  14 x--> 73
  14 --- 86
  14 --- 111
  15 --- 52
  15 x--> 73
  15 --- 84
  15 --- 106
  16 --- 51
  16 x--> 73
  16 --- 85
  16 --- 109
  17 --- 55
  17 x--> 73
  17 --- 87
  17 --- 112
  18 --- 57
  18 x--> 73
  18 --- 90
  18 --- 108
  19 --- 56
  19 x--> 73
  19 --- 89
  19 --- 113
  20 --- 50
  20 x--> 73
  20 --- 83
  20 --- 110
  21 --- 59
  21 x--> 81
  21 --- 93
  21 --- 115
  22 --- 60
  22 x--> 81
  22 --- 94
  22 --- 116
  23 --- 61
  23 x--> 81
  23 --- 91
  23 --- 117
  24 --- 58
  24 x--> 81
  24 --- 92
  24 --- 114
  26 --- 62
  26 x--> 79
  26 --- 97
  26 --- 121
  27 --- 65
  27 x--> 79
  27 --- 96
  27 --- 119
  28 --- 64
  28 x--> 79
  28 --- 98
  28 --- 120
  29 --- 63
  29 x--> 79
  29 --- 95
  29 --- 118
  31 --- 66
  31 x--> 75
  31 --- 100
  31 --- 123
  32 --- 68
  32 x--> 75
  32 --- 99
  32 --- 122
  33 --- 67
  33 x--> 75
  33 --- 101
  33 --- 124
  34 --- 72
  34 x--> 77
  34 --- 104
  34 --- 126
  35 --- 70
  35 x--> 77
  35 --- 102
  35 --- 127
  36 --- 71
  36 x--> 77
  36 --- 105
  36 --- 128
  37 --- 69
  37 x--> 77
  37 --- 103
  37 --- 125
  45 --- 50
  45 --- 51
  45 --- 52
  45 --- 53
  45 --- 54
  45 --- 55
  45 --- 56
  45 --- 57
  45 --- 73
  45 --- 78
  45 --- 83
  45 --- 84
  45 --- 85
  45 --- 86
  45 --- 87
  45 --- 88
  45 --- 89
  45 --- 90
  45 --- 106
  45 --- 107
  45 --- 108
  45 --- 109
  45 --- 110
  45 --- 111
  45 --- 112
  45 --- 113
  46 --- 58
  46 --- 59
  46 --- 60
  46 --- 61
  46 --- 76
  46 --- 81
  46 --- 91
  46 --- 92
  46 --- 93
  46 --- 94
  46 --- 114
  46 --- 115
  46 --- 116
  46 --- 117
  47 --- 62
  47 --- 63
  47 --- 64
  47 --- 65
  47 --- 74
  47 --- 79
  47 --- 95
  47 --- 96
  47 --- 97
  47 --- 98
  47 --- 118
  47 --- 119
  47 --- 120
  47 --- 121
  48 --- 66
  48 --- 67
  48 --- 68
  48 --- 75
  48 --- 80
  48 --- 99
  48 --- 100
  48 --- 101
  48 --- 122
  48 --- 123
  48 --- 124
  49 --- 69
  49 --- 70
  49 --- 71
  49 --- 72
  49 --- 77
  49 --- 82
  49 --- 102
  49 --- 103
  49 --- 104
  49 --- 105
  49 --- 125
  49 --- 126
  49 --- 127
  49 --- 128
  83 <--x 50
  110 <--x 50
  113 <--x 50
  85 <--x 51
  106 <--x 51
  109 <--x 51
  84 <--x 52
  106 <--x 52
  111 <--x 52
  88 <--x 53
  107 <--x 53
  110 <--x 53
  86 <--x 54
  107 <--x 54
  111 <--x 54
  87 <--x 55
  109 <--x 55
  112 <--x 55
  89 <--x 56
  108 <--x 56
  113 <--x 56
  90 <--x 57
  108 <--x 57
  112 <--x 57
  92 <--x 58
  114 <--x 58
  117 <--x 58
  93 <--x 59
  114 <--x 59
  94 <--x 60
  91 <--x 61
  117 <--x 61
  97 <--x 62
  118 <--x 62
  95 <--x 63
  118 <--x 63
  120 <--x 63
  98 <--x 64
  120 <--x 64
  96 <--x 65
  100 <--x 66
  123 <--x 66
  124 <--x 66
  101 <--x 67
  122 <--x 67
  124 <--x 67
  99 <--x 68
  122 <--x 68
  123 <--x 68
  103 <--x 69
  125 <--x 69
  128 <--x 69
  102 <--x 70
  126 <--x 70
  127 <--x 70
  105 <--x 71
  127 <--x 71
  128 <--x 71
  104 <--x 72
  125 <--x 72
  126 <--x 72
  95 <--x 74
  96 <--x 74
  97 <--x 74
  98 <--x 74
  91 <--x 76
  92 <--x 76
  93 <--x 76
  94 <--x 76
  83 <--x 78
  84 <--x 78
  85 <--x 78
  86 <--x 78
  87 <--x 78
  88 <--x 78
  89 <--x 78
  90 <--x 78
  99 <--x 80
  100 <--x 80
  101 <--x 80
  102 <--x 82
  103 <--x 82
  104 <--x 82
  105 <--x 82
  107 <--x 129
  108 <--x 129
  111 <--x 129
  112 <--x 129
  115 <--x 130
  116 <--x 130
  119 <--x 131
  121 <--x 131
```

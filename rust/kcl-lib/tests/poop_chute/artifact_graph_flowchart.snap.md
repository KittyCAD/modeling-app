```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[206, 250, 0]"]
    5["Segment<br>[256, 290, 0]"]
    6["Segment<br>[296, 365, 0]"]
    7["Segment<br>[371, 398, 0]"]
    8["Segment<br>[404, 435, 0]"]
    9["Segment<br>[441, 476, 0]"]
    10["Segment<br>[482, 562, 0]"]
    11["Segment<br>[568, 599, 0]"]
    12["Segment<br>[605, 664, 0]"]
    13["Segment<br>[670, 697, 0]"]
    14["Segment<br>[703, 725, 0]"]
    15["Segment<br>[731, 766, 0]"]
    16["Segment<br>[772, 818, 0]"]
    17["Segment<br>[824, 832, 0]"]
    32[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[1000, 1044, 0]"]
    18["Segment<br>[1050, 1084, 0]"]
    19["Segment<br>[1090, 1159, 0]"]
    20["Segment<br>[1165, 1192, 0]"]
    21["Segment<br>[1198, 1229, 0]"]
    22["Segment<br>[1235, 1270, 0]"]
    23["Segment<br>[1276, 1356, 0]"]
    24["Segment<br>[1362, 1393, 0]"]
    25["Segment<br>[1399, 1458, 0]"]
    26["Segment<br>[1464, 1491, 0]"]
    27["Segment<br>[1497, 1519, 0]"]
    28["Segment<br>[1525, 1560, 0]"]
    29["Segment<br>[1566, 1612, 0]"]
    30["Segment<br>[1618, 1626, 0]"]
    31[Solid2d]
  end
  1["Plane<br>[182, 200, 0]"]
  2["Plane<br>[976, 994, 0]"]
  33["Sweep Revolve<br>[843, 962, 0]"]
  34["Sweep Extrusion<br>[1632, 1670, 0]"]
  35[Wall]
  36[Wall]
  37[Wall]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
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
  61["Cap Start"]
  62["Cap Start"]
  63["Cap End"]
  64["Cap End"]
  65["SweepEdge Opposite"]
  66["SweepEdge Adjacent"]
  67["SweepEdge Opposite"]
  68["SweepEdge Adjacent"]
  69["SweepEdge Opposite"]
  70["SweepEdge Adjacent"]
  71["SweepEdge Opposite"]
  72["SweepEdge Adjacent"]
  73["SweepEdge Opposite"]
  74["SweepEdge Adjacent"]
  75["SweepEdge Opposite"]
  76["SweepEdge Adjacent"]
  77["SweepEdge Opposite"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Opposite"]
  80["SweepEdge Adjacent"]
  81["SweepEdge Opposite"]
  82["SweepEdge Adjacent"]
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
  3 --- 32
  3 ---- 33
  4 --- 18
  4 --- 19
  4 --- 20
  4 --- 21
  4 --- 22
  4 --- 23
  4 --- 24
  4 --- 25
  4 --- 26
  4 --- 27
  4 --- 28
  4 --- 29
  4 --- 30
  4 --- 31
  4 ---- 34
  5 --- 41
  5 x--> 61
  5 --- 77
  5 --- 78
  6 --- 40
  6 x--> 61
  6 --- 75
  6 --- 76
  7 --- 42
  7 x--> 61
  7 --- 79
  7 --- 80
  8 --- 38
  8 x--> 61
  8 --- 71
  8 --- 72
  9 --- 37
  9 x--> 61
  9 --- 69
  9 --- 70
  10 --- 44
  10 x--> 61
  10 --- 83
  10 --- 84
  11 --- 46
  11 x--> 61
  11 --- 87
  11 --- 88
  12 --- 45
  12 x--> 61
  12 --- 85
  12 --- 86
  13 --- 35
  13 x--> 61
  13 --- 65
  13 --- 66
  14 --- 36
  14 x--> 61
  14 --- 67
  14 --- 68
  15 --- 47
  15 x--> 61
  15 --- 89
  15 --- 90
  16 --- 43
  16 x--> 61
  16 --- 81
  16 --- 82
  17 --- 39
  17 x--> 61
  17 --- 73
  17 --- 74
  18 --- 55
  18 x--> 62
  18 --- 105
  18 --- 106
  19 --- 54
  19 x--> 62
  19 --- 103
  19 --- 104
  20 --- 50
  20 x--> 62
  20 --- 95
  20 --- 96
  21 --- 51
  21 x--> 62
  21 --- 97
  21 --- 98
  22 --- 49
  22 x--> 62
  22 --- 93
  22 --- 94
  23 --- 59
  23 x--> 62
  23 --- 113
  23 --- 114
  24 --- 52
  24 x--> 62
  24 --- 99
  24 --- 100
  25 --- 58
  25 x--> 62
  25 --- 111
  25 --- 112
  26 --- 60
  26 x--> 62
  26 --- 115
  26 --- 116
  27 --- 56
  27 x--> 62
  27 --- 107
  27 --- 108
  28 --- 48
  28 x--> 62
  28 --- 91
  28 --- 92
  29 --- 53
  29 x--> 62
  29 --- 101
  29 --- 102
  30 --- 57
  30 x--> 62
  30 --- 109
  30 --- 110
  33 --- 35
  33 --- 36
  33 --- 37
  33 --- 38
  33 --- 39
  33 --- 40
  33 --- 41
  33 --- 42
  33 --- 43
  33 --- 44
  33 --- 45
  33 --- 46
  33 --- 47
  33 --- 61
  33 --- 63
  33 --- 65
  33 --- 66
  33 --- 67
  33 --- 68
  33 --- 69
  33 --- 70
  33 --- 71
  33 --- 72
  33 --- 73
  33 --- 74
  33 --- 75
  33 --- 76
  33 --- 77
  33 --- 78
  33 --- 79
  33 --- 80
  33 --- 81
  33 --- 82
  33 --- 83
  33 --- 84
  33 --- 85
  33 --- 86
  33 --- 87
  33 --- 88
  33 --- 89
  33 --- 90
  34 --- 48
  34 --- 49
  34 --- 50
  34 --- 51
  34 --- 52
  34 --- 53
  34 --- 54
  34 --- 55
  34 --- 56
  34 --- 57
  34 --- 58
  34 --- 59
  34 --- 60
  34 --- 62
  34 --- 64
  34 --- 91
  34 --- 92
  34 --- 93
  34 --- 94
  34 --- 95
  34 --- 96
  34 --- 97
  34 --- 98
  34 --- 99
  34 --- 100
  34 --- 101
  34 --- 102
  34 --- 103
  34 --- 104
  34 --- 105
  34 --- 106
  34 --- 107
  34 --- 108
  34 --- 109
  34 --- 110
  34 --- 111
  34 --- 112
  34 --- 113
  34 --- 114
  34 --- 115
  34 --- 116
  65 <--x 35
  66 <--x 35
  86 <--x 35
  66 <--x 36
  67 <--x 36
  68 <--x 36
  69 <--x 37
  70 <--x 37
  72 <--x 37
  71 <--x 38
  72 <--x 38
  80 <--x 38
  73 <--x 39
  74 <--x 39
  82 <--x 39
  75 <--x 40
  76 <--x 40
  78 <--x 40
  74 <--x 41
  77 <--x 41
  78 <--x 41
  76 <--x 42
  79 <--x 42
  80 <--x 42
  81 <--x 43
  82 <--x 43
  90 <--x 43
  70 <--x 44
  83 <--x 44
  84 <--x 44
  85 <--x 45
  86 <--x 45
  88 <--x 45
  84 <--x 46
  87 <--x 46
  88 <--x 46
  68 <--x 47
  89 <--x 47
  90 <--x 47
  91 <--x 48
  92 <--x 48
  108 <--x 48
  93 <--x 49
  94 <--x 49
  98 <--x 49
  95 <--x 50
  96 <--x 50
  104 <--x 50
  96 <--x 51
  97 <--x 51
  98 <--x 51
  99 <--x 52
  100 <--x 52
  114 <--x 52
  92 <--x 53
  101 <--x 53
  102 <--x 53
  103 <--x 54
  104 <--x 54
  106 <--x 54
  105 <--x 55
  106 <--x 55
  110 <--x 55
  107 <--x 56
  108 <--x 56
  116 <--x 56
  102 <--x 57
  109 <--x 57
  110 <--x 57
  100 <--x 58
  111 <--x 58
  112 <--x 58
  94 <--x 59
  113 <--x 59
  114 <--x 59
  112 <--x 60
  115 <--x 60
  116 <--x 60
  65 <--x 63
  67 <--x 63
  69 <--x 63
  71 <--x 63
  73 <--x 63
  75 <--x 63
  77 <--x 63
  79 <--x 63
  81 <--x 63
  83 <--x 63
  85 <--x 63
  87 <--x 63
  89 <--x 63
  91 <--x 64
  93 <--x 64
  95 <--x 64
  97 <--x 64
  99 <--x 64
  101 <--x 64
  103 <--x 64
  105 <--x 64
  107 <--x 64
  109 <--x 64
  111 <--x 64
  113 <--x 64
  115 <--x 64
```

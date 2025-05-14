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
  66["SweepEdge Opposite"]
  67["SweepEdge Opposite"]
  68["SweepEdge Opposite"]
  69["SweepEdge Opposite"]
  70["SweepEdge Opposite"]
  71["SweepEdge Opposite"]
  72["SweepEdge Opposite"]
  73["SweepEdge Opposite"]
  74["SweepEdge Opposite"]
  75["SweepEdge Opposite"]
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
  91["SweepEdge Adjacent"]
  92["SweepEdge Adjacent"]
  93["SweepEdge Adjacent"]
  94["SweepEdge Adjacent"]
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
  114["SweepEdge Adjacent"]
  115["SweepEdge Adjacent"]
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
  5 x--> 63
  5 --- 65
  5 --- 91
  6 --- 40
  6 x--> 63
  6 --- 66
  6 --- 92
  7 --- 42
  7 x--> 63
  7 --- 67
  7 --- 93
  8 --- 38
  8 x--> 63
  8 --- 68
  8 --- 94
  9 --- 37
  9 x--> 63
  9 --- 69
  9 --- 95
  10 --- 44
  10 x--> 63
  10 --- 70
  10 --- 96
  11 --- 46
  11 x--> 63
  11 --- 71
  11 --- 97
  12 --- 45
  12 x--> 63
  12 --- 72
  12 --- 98
  13 --- 35
  13 x--> 63
  13 --- 73
  13 --- 99
  14 --- 36
  14 x--> 63
  14 --- 74
  14 --- 100
  15 --- 47
  15 x--> 63
  15 --- 75
  15 --- 101
  16 --- 43
  16 x--> 63
  16 --- 76
  16 --- 102
  17 --- 39
  17 x--> 63
  17 --- 77
  17 --- 103
  18 --- 51
  18 x--> 62
  18 --- 78
  18 --- 104
  19 --- 53
  19 x--> 62
  19 --- 79
  19 --- 105
  20 --- 48
  20 x--> 62
  20 --- 80
  20 --- 106
  21 --- 60
  21 x--> 62
  21 --- 81
  21 --- 107
  22 --- 49
  22 x--> 62
  22 --- 82
  22 --- 108
  23 --- 57
  23 x--> 62
  23 --- 83
  23 --- 109
  24 --- 54
  24 x--> 62
  24 --- 84
  24 --- 110
  25 --- 52
  25 x--> 62
  25 --- 85
  25 --- 111
  26 --- 56
  26 x--> 62
  26 --- 86
  26 --- 112
  27 --- 50
  27 x--> 62
  27 --- 87
  27 --- 113
  28 --- 58
  28 x--> 62
  28 --- 88
  28 --- 114
  29 --- 59
  29 x--> 62
  29 --- 89
  29 --- 115
  30 --- 55
  30 x--> 62
  30 --- 90
  30 --- 116
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
  33 --- 91
  33 --- 92
  33 --- 93
  33 --- 94
  33 --- 95
  33 --- 96
  33 --- 97
  33 --- 98
  33 --- 99
  33 --- 100
  33 --- 101
  33 --- 102
  33 --- 103
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
  34 --- 78
  34 --- 79
  34 --- 80
  34 --- 81
  34 --- 82
  34 --- 83
  34 --- 84
  34 --- 85
  34 --- 86
  34 --- 87
  34 --- 88
  34 --- 89
  34 --- 90
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
  35 --- 73
  98 <--x 35
  35 --- 99
  36 --- 74
  99 <--x 36
  36 --- 100
  37 --- 69
  94 <--x 37
  37 --- 95
  38 --- 68
  93 <--x 38
  38 --- 94
  39 --- 77
  102 <--x 39
  39 --- 103
  40 --- 66
  91 <--x 40
  40 --- 92
  41 --- 65
  41 --- 91
  103 <--x 41
  42 --- 67
  92 <--x 42
  42 --- 93
  43 --- 76
  101 <--x 43
  43 --- 102
  44 --- 70
  95 <--x 44
  44 --- 96
  45 --- 72
  97 <--x 45
  45 --- 98
  46 --- 71
  96 <--x 46
  46 --- 97
  47 --- 75
  100 <--x 47
  47 --- 101
  48 --- 80
  105 <--x 48
  48 --- 106
  49 --- 82
  107 <--x 49
  49 --- 108
  50 --- 87
  112 <--x 50
  50 --- 113
  51 --- 78
  51 --- 104
  116 <--x 51
  52 --- 85
  110 <--x 52
  52 --- 111
  53 --- 79
  104 <--x 53
  53 --- 105
  54 --- 84
  109 <--x 54
  54 --- 110
  55 --- 90
  115 <--x 55
  55 --- 116
  56 --- 86
  111 <--x 56
  56 --- 112
  57 --- 83
  108 <--x 57
  57 --- 109
  58 --- 88
  113 <--x 58
  58 --- 114
  59 --- 89
  114 <--x 59
  59 --- 115
  60 --- 81
  106 <--x 60
  60 --- 107
  65 <--x 61
  66 <--x 61
  67 <--x 61
  68 <--x 61
  69 <--x 61
  70 <--x 61
  71 <--x 61
  72 <--x 61
  73 <--x 61
  74 <--x 61
  75 <--x 61
  76 <--x 61
  77 <--x 61
  78 <--x 64
  79 <--x 64
  80 <--x 64
  81 <--x 64
  82 <--x 64
  83 <--x 64
  84 <--x 64
  85 <--x 64
  86 <--x 64
  87 <--x 64
  88 <--x 64
  89 <--x 64
  90 <--x 64
```

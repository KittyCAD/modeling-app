```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[557, 600, 0]"]
    7["Segment<br>[606, 645, 0]"]
    8["Segment<br>[651, 716, 0]"]
    9["Segment<br>[722, 798, 0]"]
    10["Segment<br>[804, 873, 0]"]
    11["Segment<br>[879, 919, 0]"]
    12["Segment<br>[925, 961, 0]"]
    13["Segment<br>[1001, 1031, 0]"]
    14["Segment<br>[1037, 1066, 0]"]
    15["Segment<br>[1072, 1101, 0]"]
    16["Segment<br>[1107, 1136, 0]"]
    17["Segment<br>[1142, 1209, 0]"]
    18["Segment<br>[1215, 1271, 0]"]
    19["Segment<br>[1277, 1284, 0]"]
    32[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[1444, 1544, 0]"]
    20["Segment<br>[1550, 1597, 0]"]
    21["Segment<br>[1603, 1715, 0]"]
    22["Segment<br>[1721, 1838, 0]"]
    23["Segment<br>[1844, 1900, 0]"]
    24["Segment<br>[1906, 1913, 0]"]
    31[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[2075, 2174, 0]"]
    25["Segment<br>[2180, 2226, 0]"]
    26["Segment<br>[2232, 2315, 0]"]
    27["Segment<br>[2321, 2409, 0]"]
    28["Segment<br>[2415, 2471, 0]"]
    29["Segment<br>[2477, 2484, 0]"]
    30[Solid2d]
  end
  1["Plane<br>[534, 551, 0]"]
  2["StartSketchOnFace<br>[1399, 1438, 0]"]
  3["StartSketchOnFace<br>[2030, 2069, 0]"]
  33["Sweep Extrusion<br>[1327, 1357, 0]"]
  34["Sweep Extrusion<br>[1957, 1989, 0]"]
  35["Sweep Extrusion<br>[2527, 2559, 0]"]
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
  55["Cap Start"]
  56["Cap Start"]
  57["Cap Start"]
  58["Cap End"]
  59["Cap End"]
  60["Cap End"]
  61["SweepEdge Opposite"]
  62["SweepEdge Opposite"]
  63["SweepEdge Opposite"]
  64["SweepEdge Opposite"]
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
  80["SweepEdge Adjacent"]
  81["SweepEdge Adjacent"]
  82["SweepEdge Adjacent"]
  83["SweepEdge Adjacent"]
  84["SweepEdge Adjacent"]
  85["SweepEdge Adjacent"]
  86["SweepEdge Adjacent"]
  87["SweepEdge Adjacent"]
  88["SweepEdge Adjacent"]
  89["SweepEdge Adjacent"]
  90["SweepEdge Adjacent"]
  91["SweepEdge Adjacent"]
  92["SweepEdge Adjacent"]
  93["SweepEdge Adjacent"]
  94["SweepEdge Adjacent"]
  95["SweepEdge Adjacent"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Adjacent"]
  1 --- 4
  57 x--> 2
  57 x--> 3
  4 --- 7
  4 --- 8
  4 --- 9
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 --- 14
  4 --- 15
  4 --- 16
  4 --- 17
  4 --- 18
  4 --- 19
  4 --- 32
  4 ---- 33
  5 --- 20
  5 --- 21
  5 --- 22
  5 --- 23
  5 --- 24
  5 --- 31
  5 ---- 34
  57 --- 5
  6 --- 25
  6 --- 26
  6 --- 27
  6 --- 28
  6 --- 29
  6 --- 30
  6 ---- 35
  57 --- 6
  7 --- 43
  7 x--> 57
  7 --- 71
  7 --- 89
  8 --- 40
  8 x--> 57
  8 --- 70
  8 --- 88
  9 --- 39
  9 x--> 57
  9 --- 69
  9 --- 87
  10 --- 41
  10 x--> 57
  10 --- 68
  10 --- 86
  11 --- 38
  11 x--> 57
  11 --- 67
  11 --- 85
  13 --- 42
  13 x--> 57
  13 --- 66
  13 --- 84
  14 --- 45
  14 x--> 57
  14 --- 65
  14 --- 83
  15 --- 44
  15 x--> 57
  15 --- 64
  15 --- 82
  16 --- 36
  16 x--> 57
  16 --- 63
  16 --- 81
  17 --- 37
  17 x--> 57
  17 --- 62
  17 --- 80
  18 --- 46
  18 x--> 57
  18 --- 61
  18 x--> 89
  20 --- 48
  20 x--> 55
  20 --- 72
  20 --- 90
  21 --- 49
  21 x--> 55
  21 --- 73
  21 --- 91
  22 --- 47
  22 x--> 55
  22 --- 74
  22 --- 92
  23 --- 50
  23 x--> 55
  23 --- 75
  23 --- 93
  25 --- 54
  25 x--> 56
  25 --- 79
  25 --- 97
  26 --- 51
  26 x--> 56
  26 --- 78
  26 --- 96
  27 --- 53
  27 x--> 56
  27 --- 77
  27 --- 95
  28 --- 52
  28 x--> 56
  28 --- 76
  28 --- 94
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
  33 --- 57
  33 --- 60
  33 --- 61
  33 --- 62
  33 --- 63
  33 --- 64
  33 --- 65
  33 --- 66
  33 --- 67
  33 --- 68
  33 --- 69
  33 --- 70
  33 --- 71
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
  34 --- 47
  34 --- 48
  34 --- 49
  34 --- 50
  34 --- 55
  34 --- 58
  34 --- 72
  34 --- 73
  34 --- 74
  34 --- 75
  34 --- 90
  34 --- 91
  34 --- 92
  34 --- 93
  35 --- 51
  35 --- 52
  35 --- 53
  35 --- 54
  35 --- 56
  35 --- 59
  35 --- 76
  35 --- 77
  35 --- 78
  35 --- 79
  35 --- 94
  35 --- 95
  35 --- 96
  35 --- 97
  36 --- 63
  36 --- 81
  82 <--x 36
  37 --- 62
  37 --- 80
  81 <--x 37
  38 --- 67
  38 --- 85
  39 --- 69
  86 <--x 39
  39 --- 87
  40 --- 70
  87 <--x 40
  40 --- 88
  41 --- 68
  85 <--x 41
  41 --- 86
  42 --- 66
  42 --- 84
  43 --- 71
  88 <--x 43
  43 --- 89
  44 --- 64
  44 --- 82
  83 <--x 44
  45 --- 65
  45 --- 83
  84 <--x 45
  46 --- 61
  80 <--x 46
  46 --- 89
  47 --- 74
  91 <--x 47
  47 --- 92
  48 --- 72
  48 --- 90
  93 <--x 48
  49 --- 73
  90 <--x 49
  49 --- 91
  50 --- 75
  92 <--x 50
  50 --- 93
  51 --- 78
  95 <--x 51
  51 --- 96
  52 --- 76
  52 --- 94
  97 <--x 52
  53 --- 77
  94 <--x 53
  53 --- 95
  54 --- 79
  96 <--x 54
  54 --- 97
  72 <--x 58
  73 <--x 58
  74 <--x 58
  75 <--x 58
  76 <--x 59
  77 <--x 59
  78 <--x 59
  79 <--x 59
  61 <--x 60
  62 <--x 60
  63 <--x 60
  64 <--x 60
  65 <--x 60
  66 <--x 60
  67 <--x 60
  68 <--x 60
  69 <--x 60
  70 <--x 60
  71 <--x 60
```

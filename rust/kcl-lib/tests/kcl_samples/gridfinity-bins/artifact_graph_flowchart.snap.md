```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[927, 973, 0]"]
    3["Segment<br>[981, 1003, 0]"]
    4["Segment<br>[1011, 1041, 0]"]
    5["Segment<br>[1049, 1108, 0]"]
    6["Segment<br>[1116, 1143, 0]"]
    7["Segment<br>[1151, 1210, 0]"]
    8["Segment<br>[1218, 1225, 0]"]
    9[Solid2d]
  end
  subgraph path29 [Path]
    29["Path<br>[927, 973, 0]"]
    30["Segment<br>[981, 1003, 0]"]
    31["Segment<br>[1011, 1041, 0]"]
    32["Segment<br>[1049, 1108, 0]"]
    33["Segment<br>[1116, 1143, 0]"]
    34["Segment<br>[1151, 1210, 0]"]
    35["Segment<br>[1218, 1225, 0]"]
    36[Solid2d]
  end
  subgraph path56 [Path]
    56["Path<br>[2288, 2376, 0]"]
    57["Segment<br>[2382, 2446, 0]"]
    58["Segment<br>[2452, 2516, 0]"]
    59["Segment<br>[2522, 2575, 0]"]
    60["Segment<br>[2581, 2602, 0]"]
    61[Solid2d]
  end
  subgraph path81 [Path]
    81["Path<br>[2928, 3094, 0]"]
    82["Segment<br>[2928, 3094, 0]"]
    83[Solid2d]
  end
  subgraph path93 [Path]
    93["Path<br>[4407, 4432, 0]"]
    94["Segment<br>[4438, 4510, 0]"]
    95["Segment<br>[4516, 4589, 0]"]
    96["Segment<br>[4595, 4648, 0]"]
    97["Segment<br>[4654, 4675, 0]"]
    98[Solid2d]
  end
  1["Plane<br>[1311, 1358, 0]"]
  10["Sweep Extrusion<br>[1298, 1401, 0]"]
  11[Wall]
  12[Wall]
  13[Wall]
  14[Wall]
  15[Wall]
  16["Cap Start"]
  17["Cap End"]
  18["SweepEdge Opposite"]
  19["SweepEdge Adjacent"]
  20["SweepEdge Opposite"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Opposite"]
  23["SweepEdge Adjacent"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Opposite"]
  27["SweepEdge Adjacent"]
  28["Plane<br>[1912, 1959, 0]"]
  37["Sweep Revolve<br>[1899, 1990, 0]"]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43["Cap Start"]
  44["Cap End"]
  45["SweepEdge Opposite"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Opposite"]
  54["SweepEdge Adjacent"]
  55["Plane<br>[2265, 2282, 0]"]
  62["Sweep Extrusion<br>[2608, 2632, 0]"]
  63[Wall]
  64[Wall]
  65[Wall]
  66[Wall]
  67["Cap Start"]
  68["Cap End"]
  69["SweepEdge Opposite"]
  70["SweepEdge Adjacent"]
  71["SweepEdge Opposite"]
  72["SweepEdge Adjacent"]
  73["SweepEdge Opposite"]
  74["SweepEdge Adjacent"]
  75["SweepEdge Opposite"]
  76["SweepEdge Adjacent"]
  77["EdgeCut Fillet<br>[2638, 2868, 0]"]
  78["EdgeCut Fillet<br>[2638, 2868, 0]"]
  79["EdgeCut Fillet<br>[2638, 2868, 0]"]
  80["EdgeCut Fillet<br>[2638, 2868, 0]"]
  84["Sweep Extrusion<br>[3316, 3343, 0]"]
  85[Wall]
  86["Cap Start"]
  87["SweepEdge Opposite"]
  88["SweepEdge Adjacent"]
  89["Sweep Extrusion<br>[3316, 3343, 0]"]
  90["Sweep Extrusion<br>[3316, 3343, 0]"]
  91["Sweep Extrusion<br>[3316, 3343, 0]"]
  92["Plane<br>[4368, 4400, 0]"]
  99["Sweep Extrusion<br>[4681, 4725, 0]"]
  100[Wall]
  101[Wall]
  102[Wall]
  103[Wall]
  104["Cap Start"]
  105["Cap End"]
  106["SweepEdge Opposite"]
  107["SweepEdge Adjacent"]
  108["SweepEdge Opposite"]
  109["SweepEdge Adjacent"]
  110["SweepEdge Opposite"]
  111["SweepEdge Adjacent"]
  112["SweepEdge Opposite"]
  113["SweepEdge Adjacent"]
  114["EdgeCut Fillet<br>[4731, 4964, 0]"]
  115["EdgeCut Fillet<br>[4731, 4964, 0]"]
  116["EdgeCut Fillet<br>[4731, 4964, 0]"]
  117["EdgeCut Fillet<br>[4731, 4964, 0]"]
  118["StartSketchOnPlane<br>[899, 919, 0]"]
  119["StartSketchOnPlane<br>[899, 919, 0]"]
  120["StartSketchOnFace<br>[2885, 2922, 0]"]
  121["StartSketchOnPlane<br>[4354, 4401, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 ---- 10
  2 --- 9
  3 --- 11
  3 --- 18
  3 --- 19
  4 --- 12
  4 --- 20
  4 --- 21
  5 --- 13
  5 --- 22
  5 --- 23
  6 --- 14
  6 --- 24
  6 --- 25
  7 --- 15
  7 --- 26
  7 --- 27
  10 --- 11
  10 --- 12
  10 --- 13
  10 --- 14
  10 --- 15
  10 --- 16
  10 --- 17
  10 --- 18
  10 --- 19
  10 --- 20
  10 --- 21
  10 --- 22
  10 --- 23
  10 --- 24
  10 --- 25
  10 --- 26
  10 --- 27
  28 --- 29
  29 --- 30
  29 --- 31
  29 --- 32
  29 --- 33
  29 --- 34
  29 --- 35
  29 ---- 37
  29 --- 36
  30 --- 38
  30 --- 45
  30 --- 46
  31 --- 39
  31 --- 47
  31 --- 48
  32 --- 40
  32 --- 49
  32 --- 50
  33 --- 41
  33 --- 51
  33 --- 52
  34 --- 42
  34 --- 53
  34 --- 54
  37 --- 38
  37 --- 39
  37 --- 40
  37 --- 41
  37 --- 42
  37 --- 43
  37 --- 44
  37 --- 45
  37 --- 46
  37 --- 47
  37 --- 48
  37 --- 49
  37 --- 50
  37 --- 51
  37 --- 52
  37 --- 53
  37 --- 54
  55 --- 56
  56 --- 57
  56 --- 58
  56 --- 59
  56 --- 60
  56 ---- 62
  56 --- 61
  57 --- 63
  57 --- 69
  57 --- 70
  58 --- 64
  58 --- 71
  58 --- 72
  59 --- 65
  59 --- 73
  59 --- 74
  60 --- 66
  60 --- 75
  60 --- 76
  62 --- 63
  62 --- 64
  62 --- 65
  62 --- 66
  62 --- 67
  62 --- 68
  62 --- 69
  62 --- 70
  62 --- 71
  62 --- 72
  62 --- 73
  62 --- 74
  62 --- 75
  62 --- 76
  67 --- 81
  70 <--x 77
  76 <--x 78
  74 <--x 79
  72 <--x 80
  81 --- 82
  81 ---- 84
  81 --- 83
  82 --- 85
  82 --- 87
  82 --- 88
  84 --- 85
  84 --- 86
  84 --- 87
  84 --- 88
  92 --- 93
  93 --- 94
  93 --- 95
  93 --- 96
  93 --- 97
  93 ---- 99
  93 --- 98
  94 --- 100
  94 --- 106
  94 --- 107
  95 --- 101
  95 --- 108
  95 --- 109
  96 --- 102
  96 --- 110
  96 --- 111
  97 --- 103
  97 --- 112
  97 --- 113
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
  99 --- 111
  99 --- 112
  99 --- 113
  107 <--x 114
  113 <--x 115
  111 <--x 116
  109 <--x 117
  1 <--x 118
  28 <--x 119
  67 <--x 120
  92 <--x 121
```

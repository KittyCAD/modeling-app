```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[578, 1337, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[617, 691, 0]"]
      %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    4["Segment<br>[1072, 1150, 0]"]
      %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path5 [Path]
    5["Path Region<br>[1359, 1502, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    6["Segment<br>[1359, 1502, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path14 [Path]
    14["Path<br>[1601, 2363, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    15["Segment<br>[1641, 1713, 0]"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    16["Segment<br>[2097, 2169, 0]"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path17 [Path]
    17["Path Region<br>[2380, 2519, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    18["Segment<br>[2380, 2519, 0]"]
      %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    129["Segment<br>[3941, 3962, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  subgraph path26 [Path]
    26["Path<br>[2641, 3516, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    27["Segment<br>[2695, 2766, 0]"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path28 [Path]
    28["Path Region<br>[3535, 3646, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    29["Segment<br>[3535, 3646, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    133["Segment<br>[3941, 3962, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  1["Plane<br>[578, 1337, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  7["Sweep Revolve<br>[1515, 1584, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  8[Wall]
    %% face_code_ref=Missing NodePath
  9["Cap Start"]
    %% face_code_ref=Missing NodePath
  10["Cap End"]
    %% face_code_ref=Missing NodePath
  11["SweepEdge Opposite"]
  12["SweepEdge Adjacent"]
  13["Plane<br>[1601, 2363, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  19["Sweep Extrusion<br>[2534, 2582, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  20[Wall]
    %% face_code_ref=Missing NodePath
  21["Cap Start"]
    %% face_code_ref=Missing NodePath
  22["Cap End"]
    %% face_code_ref=Missing NodePath
  23["SweepEdge Opposite"]
  24["SweepEdge Adjacent"]
  25["Plane<br>[2606, 2623, 0]"]
    %% [ProgramBodyItem { index: 17 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  30["Sweep Extrusion<br>[3662, 3712, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31[Wall]
    %% face_code_ref=Missing NodePath
  32["Cap Start"]
    %% face_code_ref=Missing NodePath
  33["Cap End"]
    %% face_code_ref=Missing NodePath
  34["SweepEdge Opposite"]
  35["SweepEdge Adjacent"]
  36["Pattern Circular<br>[3730, 3853, 0]<br>Copies: 15<br>Faces: 45<br>Edges: 45"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  37["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  38[Wall]
    %% face_code_ref=Missing NodePath
  39["Cap Start"]
    %% face_code_ref=Missing NodePath
  40["Cap End"]
    %% face_code_ref=Missing NodePath
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  43["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  44[Wall]
    %% face_code_ref=Missing NodePath
  45["Cap Start"]
    %% face_code_ref=Missing NodePath
  46["Cap End"]
    %% face_code_ref=Missing NodePath
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  50[Wall]
    %% face_code_ref=Missing NodePath
  51["Cap Start"]
    %% face_code_ref=Missing NodePath
  52["Cap End"]
    %% face_code_ref=Missing NodePath
  53["SweepEdge Opposite"]
  54["SweepEdge Adjacent"]
  55["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  56[Wall]
    %% face_code_ref=Missing NodePath
  57["Cap Start"]
    %% face_code_ref=Missing NodePath
  58["Cap End"]
    %% face_code_ref=Missing NodePath
  59["SweepEdge Opposite"]
  60["SweepEdge Adjacent"]
  61["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  62[Wall]
    %% face_code_ref=Missing NodePath
  63["Cap Start"]
    %% face_code_ref=Missing NodePath
  64["Cap End"]
    %% face_code_ref=Missing NodePath
  65["SweepEdge Opposite"]
  66["SweepEdge Adjacent"]
  67["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  68[Wall]
    %% face_code_ref=Missing NodePath
  69["Cap Start"]
    %% face_code_ref=Missing NodePath
  70["Cap End"]
    %% face_code_ref=Missing NodePath
  71["SweepEdge Opposite"]
  72["SweepEdge Adjacent"]
  73["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  74[Wall]
    %% face_code_ref=Missing NodePath
  75["Cap Start"]
    %% face_code_ref=Missing NodePath
  76["Cap End"]
    %% face_code_ref=Missing NodePath
  77["SweepEdge Opposite"]
  78["SweepEdge Adjacent"]
  79["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  80[Wall]
    %% face_code_ref=Missing NodePath
  81["Cap Start"]
    %% face_code_ref=Missing NodePath
  82["Cap End"]
    %% face_code_ref=Missing NodePath
  83["SweepEdge Opposite"]
  84["SweepEdge Adjacent"]
  85["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  86[Wall]
    %% face_code_ref=Missing NodePath
  87["Cap Start"]
    %% face_code_ref=Missing NodePath
  88["Cap End"]
    %% face_code_ref=Missing NodePath
  89["SweepEdge Opposite"]
  90["SweepEdge Adjacent"]
  91["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  92[Wall]
    %% face_code_ref=Missing NodePath
  93["Cap Start"]
    %% face_code_ref=Missing NodePath
  94["Cap End"]
    %% face_code_ref=Missing NodePath
  95["SweepEdge Opposite"]
  96["SweepEdge Adjacent"]
  97["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  98[Wall]
    %% face_code_ref=Missing NodePath
  99["Cap Start"]
    %% face_code_ref=Missing NodePath
  100["Cap End"]
    %% face_code_ref=Missing NodePath
  101["SweepEdge Opposite"]
  102["SweepEdge Adjacent"]
  103["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  104[Wall]
    %% face_code_ref=Missing NodePath
  105["Cap Start"]
    %% face_code_ref=Missing NodePath
  106["Cap End"]
    %% face_code_ref=Missing NodePath
  107["SweepEdge Opposite"]
  108["SweepEdge Adjacent"]
  109["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  110[Wall]
    %% face_code_ref=Missing NodePath
  111["Cap Start"]
    %% face_code_ref=Missing NodePath
  112["Cap End"]
    %% face_code_ref=Missing NodePath
  113["SweepEdge Opposite"]
  114["SweepEdge Adjacent"]
  115["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  116[Wall]
    %% face_code_ref=Missing NodePath
  117["Cap Start"]
    %% face_code_ref=Missing NodePath
  118["Cap End"]
    %% face_code_ref=Missing NodePath
  119["SweepEdge Opposite"]
  120["SweepEdge Adjacent"]
  121["Sweep Extrusion<br>[3730, 3853, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  122[Wall]
    %% face_code_ref=Missing NodePath
  123["Cap Start"]
    %% face_code_ref=Missing NodePath
  124["Cap End"]
    %% face_code_ref=Missing NodePath
  125["SweepEdge Opposite"]
  126["SweepEdge Adjacent"]
  127["CompositeSolid Subtract<br>[3871, 3920, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  128["CompositeSolid Subtract<br>[3941, 3962, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  130[Wall]
    %% face_code_ref=Missing NodePath
  131["Cap Start"]
    %% face_code_ref=Missing NodePath
  132["Cap End"]
    %% face_code_ref=Missing NodePath
  134[Wall]
    %% face_code_ref=Missing NodePath
  135[Wall]
    %% face_code_ref=Missing NodePath
  136[Wall]
    %% face_code_ref=Missing NodePath
  137[Wall]
    %% face_code_ref=Missing NodePath
  138[Wall]
    %% face_code_ref=Missing NodePath
  139[Wall]
    %% face_code_ref=Missing NodePath
  140[Wall]
    %% face_code_ref=Missing NodePath
  141[Wall]
    %% face_code_ref=Missing NodePath
  142[Wall]
    %% face_code_ref=Missing NodePath
  143[Wall]
    %% face_code_ref=Missing NodePath
  144[Wall]
    %% face_code_ref=Missing NodePath
  145[Wall]
    %% face_code_ref=Missing NodePath
  146[Wall]
    %% face_code_ref=Missing NodePath
  147[Wall]
    %% face_code_ref=Missing NodePath
  148[Wall]
    %% face_code_ref=Missing NodePath
  149[Wall]
    %% face_code_ref=Missing NodePath
  150["SketchBlock<br>[578, 1337, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  151["SketchBlockConstraint Coincident<br>[796, 840, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  152["SketchBlockConstraint Coincident<br>[843, 914, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  153["SketchBlockConstraint Horizontal<br>[917, 945, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  154["SketchBlockConstraint HorizontalDistance<br>[948, 1049, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  155["SketchBlockConstraint Coincident<br>[1153, 1227, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  156["SketchBlockConstraint Radius<br>[1231, 1282, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  157["SketchBlockConstraint Radius<br>[1285, 1335, 0]"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  158["SketchBlock<br>[1601, 2363, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  159["SketchBlockConstraint Coincident<br>[1819, 1864, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  160["SketchBlockConstraint Coincident<br>[1867, 1940, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  161["SketchBlockConstraint Vertical<br>[1943, 1970, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  162["SketchBlockConstraint VerticalDistance<br>[1973, 2074, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  163["SketchBlockConstraint Coincident<br>[2172, 2248, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  164["SketchBlockConstraint Radius<br>[2251, 2305, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  165["SketchBlockConstraint Radius<br>[2308, 2361, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  166["SketchBlock<br>[2641, 3516, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  167["SketchBlockConstraint Coincident<br>[2983, 3055, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  168["SketchBlockConstraint Coincident<br>[3058, 3105, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  169["SketchBlockConstraint Coincident<br>[3108, 3184, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  170["SketchBlockConstraint Horizontal<br>[3187, 3218, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  171["SketchBlockConstraint Vertical<br>[3221, 3250, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  172["SketchBlockConstraint HorizontalDistance<br>[3253, 3357, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  173["SketchBlockConstraint VerticalDistance<br>[3360, 3465, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  174["SketchBlockConstraint Radius<br>[3468, 3514, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 5
  1 <--x 150
  2 --- 3
  2 --- 4
  2 <--x 5
  150 --- 2
  3 <--x 6
  5 <--x 6
  5 ---- 7
  6 --- 8
  6 x--> 10
  6 --- 11
  6 --- 12
  7 --- 8
  7 --- 9
  7 --- 10
  7 --- 11
  7 --- 12
  8 --- 11
  8 --- 12
  11 <--x 9
  13 --- 14
  13 <--x 17
  13 <--x 158
  14 --- 15
  14 --- 16
  14 <--x 17
  158 --- 14
  15 <--x 18
  15 <--x 129
  17 <--x 18
  17 ---- 19
  17 --- 127
  17 <--x 128
  17 <--x 129
  18 --- 20
  18 x--> 22
  18 --- 23
  18 --- 24
  19 --- 20
  19 --- 21
  19 --- 22
  19 --- 23
  19 --- 24
  19 <--x 130
  19 <--x 131
  19 <--x 132
  20 --- 23
  20 --- 24
  23 <--x 21
  129 <--x 23
  130 <--x 23
  129 <--x 24
  130 <--x 24
  25 --- 26
  25 <--x 28
  25 <--x 166
  26 --- 27
  26 <--x 28
  166 --- 26
  27 <--x 29
  27 <--x 133
  28 <--x 29
  28 ---- 30
  28 --- 36
  28 <---x 37
  28 <---x 43
  28 <---x 49
  28 <---x 55
  28 <---x 61
  28 <---x 67
  28 <---x 73
  28 <---x 79
  28 <---x 85
  28 <---x 91
  28 <---x 97
  28 <---x 103
  28 <---x 109
  28 <---x 115
  28 <---x 121
  28 --- 127
  28 <--x 128
  28 <--x 133
  29 --- 31
  29 x--> 33
  29 --- 34
  29 --- 35
  29 <--x 38
  29 <--x 41
  29 <--x 42
  29 <--x 44
  29 <--x 47
  29 <--x 48
  29 <--x 50
  29 <--x 53
  29 <--x 54
  29 <--x 56
  29 <--x 59
  29 <--x 60
  29 <--x 62
  29 <--x 65
  29 <--x 66
  29 <--x 68
  29 <--x 71
  29 <--x 72
  29 <--x 74
  29 <--x 77
  29 <--x 78
  29 <--x 80
  29 <--x 83
  29 <--x 84
  29 <--x 86
  29 <--x 89
  29 <--x 90
  29 <--x 92
  29 <--x 95
  29 <--x 96
  29 <--x 98
  29 <--x 101
  29 <--x 102
  29 <--x 104
  29 <--x 107
  29 <--x 108
  29 <--x 110
  29 <--x 113
  29 <--x 114
  29 <--x 116
  29 <--x 119
  29 <--x 120
  29 <--x 122
  29 <--x 125
  29 <--x 126
  30 --- 31
  30 --- 32
  30 --- 33
  30 --- 34
  30 --- 35
  30 x--> 36
  30 <--x 134
  31 --- 34
  31 --- 35
  34 <--x 32
  133 <--x 33
  133 <--x 34
  134 <--x 34
  133 <--x 35
  134 <--x 35
  36 x--> 37
  36 x--> 38
  36 x--> 39
  36 x--> 40
  36 x--> 41
  36 x--> 42
  36 x--> 43
  36 x--> 44
  36 x--> 45
  36 x--> 46
  36 x--> 47
  36 x--> 48
  36 x--> 49
  36 x--> 50
  36 x--> 51
  36 x--> 52
  36 x--> 53
  36 x--> 54
  36 x--> 55
  36 x--> 56
  36 x--> 57
  36 x--> 58
  36 x--> 59
  36 x--> 60
  36 x--> 61
  36 x--> 62
  36 x--> 63
  36 x--> 64
  36 x--> 65
  36 x--> 66
  36 x--> 67
  36 x--> 68
  36 x--> 69
  36 x--> 70
  36 x--> 71
  36 x--> 72
  36 x--> 73
  36 x--> 74
  36 x--> 75
  36 x--> 76
  36 x--> 77
  36 x--> 78
  36 x--> 79
  36 x--> 80
  36 x--> 81
  36 x--> 82
  36 x--> 83
  36 x--> 84
  36 x--> 85
  36 x--> 86
  36 x--> 87
  36 x--> 88
  36 x--> 89
  36 x--> 90
  36 x--> 91
  36 x--> 92
  36 x--> 93
  36 x--> 94
  36 x--> 95
  36 x--> 96
  36 x--> 97
  36 x--> 98
  36 x--> 99
  36 x--> 100
  36 x--> 101
  36 x--> 102
  36 x--> 103
  36 x--> 104
  36 x--> 105
  36 x--> 106
  36 x--> 107
  36 x--> 108
  36 x--> 109
  36 x--> 110
  36 x--> 111
  36 x--> 112
  36 x--> 113
  36 x--> 114
  36 x--> 115
  36 x--> 116
  36 x--> 117
  36 x--> 118
  36 x--> 119
  36 x--> 120
  36 x--> 121
  36 x--> 122
  36 x--> 123
  36 x--> 124
  36 x--> 125
  36 x--> 126
  37 --- 38
  37 --- 39
  37 --- 40
  37 --- 41
  37 --- 42
  37 <--x 127
  37 <--x 128
  37 <--x 135
  38 --- 41
  38 --- 42
  41 <--x 39
  135 <--x 41
  135 <--x 42
  43 --- 44
  43 --- 45
  43 --- 46
  43 --- 47
  43 --- 48
  43 <--x 127
  43 <--x 128
  43 <--x 136
  44 --- 47
  44 --- 48
  47 <--x 45
  136 <--x 47
  136 <--x 48
  49 --- 50
  49 --- 51
  49 --- 52
  49 --- 53
  49 --- 54
  49 <--x 127
  49 <--x 128
  49 <--x 137
  50 --- 53
  50 --- 54
  53 <--x 51
  137 <--x 53
  137 <--x 54
  55 --- 56
  55 --- 57
  55 --- 58
  55 --- 59
  55 --- 60
  55 <--x 127
  55 <--x 128
  55 <--x 138
  56 --- 59
  56 --- 60
  59 <--x 57
  138 <--x 59
  138 <--x 60
  61 --- 62
  61 --- 63
  61 --- 64
  61 --- 65
  61 --- 66
  61 <--x 127
  61 <--x 128
  61 <--x 139
  62 --- 65
  62 --- 66
  65 <--x 63
  139 <--x 65
  139 <--x 66
  67 --- 68
  67 --- 69
  67 --- 70
  67 --- 71
  67 --- 72
  67 <--x 127
  67 <--x 128
  67 <--x 140
  68 --- 71
  68 --- 72
  71 <--x 69
  140 <--x 71
  140 <--x 72
  73 --- 74
  73 --- 75
  73 --- 76
  73 --- 77
  73 --- 78
  73 <--x 127
  73 <--x 128
  73 <--x 141
  74 --- 77
  74 --- 78
  77 <--x 75
  141 <--x 77
  141 <--x 78
  79 --- 80
  79 --- 81
  79 --- 82
  79 --- 83
  79 --- 84
  79 <--x 127
  79 <--x 128
  79 <--x 142
  80 --- 83
  80 --- 84
  83 <--x 81
  142 <--x 83
  142 <--x 84
  85 --- 86
  85 --- 87
  85 --- 88
  85 --- 89
  85 --- 90
  85 <--x 127
  85 <--x 128
  85 <--x 143
  86 --- 89
  86 --- 90
  89 <--x 87
  143 <--x 89
  143 <--x 90
  91 --- 92
  91 --- 93
  91 --- 94
  91 --- 95
  91 --- 96
  91 <--x 127
  91 <--x 128
  91 <--x 144
  92 --- 95
  92 --- 96
  95 <--x 93
  144 <--x 95
  144 <--x 96
  97 --- 98
  97 --- 99
  97 --- 100
  97 --- 101
  97 --- 102
  97 <--x 127
  97 <--x 128
  97 <--x 145
  98 --- 101
  98 --- 102
  101 <--x 99
  145 <--x 101
  145 <--x 102
  103 --- 104
  103 --- 105
  103 --- 106
  103 --- 107
  103 --- 108
  103 <--x 127
  103 <--x 128
  103 <--x 146
  104 --- 107
  104 --- 108
  107 <--x 105
  146 <--x 107
  146 <--x 108
  109 --- 110
  109 --- 111
  109 --- 112
  109 --- 113
  109 --- 114
  109 <--x 127
  109 <--x 128
  109 <--x 147
  110 --- 113
  110 --- 114
  113 <--x 111
  147 <--x 113
  147 <--x 114
  115 --- 116
  115 --- 117
  115 --- 118
  115 --- 119
  115 --- 120
  115 <--x 127
  115 <--x 128
  115 <--x 148
  116 --- 119
  116 --- 120
  119 <--x 117
  148 <--x 119
  148 <--x 120
  121 --- 122
  121 --- 123
  121 --- 124
  121 --- 125
  121 --- 126
  121 <--x 127
  121 <--x 128
  121 <--x 149
  122 --- 125
  122 --- 126
  125 <--x 123
  149 <--x 125
  149 <--x 126
  129 --- 130
  129 x--> 132
  133 --- 134
  133 <--x 135
  133 <--x 136
  133 <--x 137
  133 <--x 138
  133 <--x 139
  133 <--x 140
  133 <--x 141
  133 <--x 142
  133 <--x 143
  133 <--x 144
  133 <--x 145
  133 <--x 146
  133 <--x 147
  133 <--x 148
  133 <--x 149
```

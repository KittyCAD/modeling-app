```mermaid
flowchart LR
  subgraph path18 [Path]
    18["Path<br>[928, 2443, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    41["Segment<br>[961, 1030, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    24["Segment<br>[1045, 1112, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    25["Segment<br>[1125, 1192, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    26["Segment<br>[1206, 1275, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path13 [Path]
    13["Path Region<br>[2462, 2542, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    30["Segment<br>[2462, 2542, 0]"]
      %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    27["Segment<br>[2462, 2542, 0]"]
      %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    28["Segment<br>[2462, 2542, 0]"]
      %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    29["Segment<br>[2462, 2542, 0]"]
      %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path15 [Path]
    15["Path<br>[3388, 4254, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    31["Segment<br>[3419, 3483, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    32["Segment<br>[3498, 3564, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    33["Segment<br>[3580, 3649, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    34["Segment<br>[3663, 3730, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path14 [Path]
    14["Path Region<br>[4350, 4419, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    35["Segment<br>[4350, 4419, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    36["Segment<br>[4350, 4419, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    37["Segment<br>[4350, 4419, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    38["Segment<br>[4350, 4419, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path16 [Path]
    16["Path<br>[5159, 5329, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    39["Segment<br>[5159, 5329, 0]"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    74[Solid2d]
  end
  subgraph path17 [Path]
    17["Path<br>[5349, 5518, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    40["Segment<br>[5349, 5518, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    75[Solid2d]
  end
  23["Plane<br>[928, 2443, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  76["Sweep Extrusion<br>[2612, 2667, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  100[Wall]
    %% face_code_ref=Missing NodePath
  101[Wall]
    %% face_code_ref=Missing NodePath
  102[Wall]
    %% face_code_ref=Missing NodePath
  103[Wall]
    %% face_code_ref=Missing NodePath
  5["Cap Start"]
    %% face_code_ref=Missing NodePath
  1["Cap End"]
    %% face_code_ref=Missing NodePath
  96["SweepEdge Opposite"]
  80["SweepEdge Adjacent"]
  97["SweepEdge Opposite"]
  81["SweepEdge Adjacent"]
  98["SweepEdge Opposite"]
  82["SweepEdge Adjacent"]
  99["SweepEdge Opposite"]
  83["SweepEdge Adjacent"]
  11["EdgeCut Fillet<br>[2734, 3046, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  19["Plane<br>[3388, 4254, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  77["Sweep Extrusion<br>[4432, 4542, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  104[Wall]
    %% face_code_ref=Missing NodePath
  105[Wall]
    %% face_code_ref=Missing NodePath
  106[Wall]
    %% face_code_ref=Missing NodePath
  107[Wall]
    %% face_code_ref=Missing NodePath
  6["Cap Start"]
    %% face_code_ref=Missing NodePath
  2["Cap End"]
    %% face_code_ref=Missing NodePath
  90["SweepEdge Opposite"]
  84["SweepEdge Adjacent"]
  91["SweepEdge Opposite"]
  85["SweepEdge Adjacent"]
  92["SweepEdge Opposite"]
  86["SweepEdge Adjacent"]
  93["SweepEdge Opposite"]
  87["SweepEdge Adjacent"]
  12["EdgeCut Fillet<br>[4608, 4775, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  9["CompositeSolid Subtract<br>[4957, 5006, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 17 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  20["Plane<br>[5169, 5225, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, CallKwUnlabeledArg]
  21["Plane<br>[5359, 5415, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, CallKwUnlabeledArg]
  22["Plane<br>[5635, 5690, 0]"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit, CallKwArg { index: 0 }]
  78["Sweep Extrusion<br>[5585, 5705, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  108[Wall]
    %% face_code_ref=Missing NodePath
  7["Cap Start"]
    %% face_code_ref=Missing NodePath
  3["Cap End"]
    %% face_code_ref=Missing NodePath
  94["SweepEdge Opposite"]
  88["SweepEdge Adjacent"]
  79["Sweep Extrusion<br>[5585, 5705, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  109[Wall]
    %% face_code_ref=Missing NodePath
  8["Cap Start"]
    %% face_code_ref=Missing NodePath
  4["Cap End"]
    %% face_code_ref=Missing NodePath
  95["SweepEdge Opposite"]
  89["SweepEdge Adjacent"]
  10["CompositeSolid Subtract<br>[5723, 5772, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  43["SketchBlock<br>[928, 2443, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  44["SketchBlockConstraint Coincident<br>[1494, 1539, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  45["SketchBlockConstraint Coincident<br>[1542, 1584, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  46["SketchBlockConstraint Coincident<br>[1587, 1628, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  47["SketchBlockConstraint Coincident<br>[1631, 1675, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  48["SketchBlockConstraint Coincident<br>[1678, 1725, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  49["SketchBlockConstraint Coincident<br>[1728, 1808, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  50["SketchBlockConstraint Coincident<br>[1811, 1860, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  51["SketchBlockConstraint Coincident<br>[1863, 1913, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 13 }, ExpressionStatementExpr]
  56["SketchBlockConstraint Horizontal<br>[1917, 1939, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 14 }, ExpressionStatementExpr]
  57["SketchBlockConstraint Horizontal<br>[1942, 1961, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 15 }, ExpressionStatementExpr]
  58["SketchBlockConstraint Horizontal<br>[1964, 1997, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 16 }, ExpressionStatementExpr]
  65["SketchBlockConstraint Vertical<br>[2000, 2019, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 17 }, ExpressionStatementExpr]
  66["SketchBlockConstraint Vertical<br>[2022, 2040, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 18 }, ExpressionStatementExpr]
  67["SketchBlockConstraint Vertical<br>[2043, 2072, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 19 }, ExpressionStatementExpr]
  61["SketchBlockConstraint HorizontalDistance<br>[2076, 2152, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 20 }, ExpressionStatementExpr]
  70["SketchBlockConstraint VerticalDistance<br>[2155, 2225, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 21 }, ExpressionStatementExpr]
  71["SketchBlockConstraint VerticalDistance<br>[2228, 2330, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 22 }, ExpressionStatementExpr]
  62["SketchBlockConstraint HorizontalDistance<br>[2333, 2441, 0]"]
    %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 23 }, ExpressionStatementExpr]
  42["SketchBlock<br>[3388, 4254, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  52["SketchBlockConstraint Coincident<br>[3734, 3776, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  53["SketchBlockConstraint Coincident<br>[3779, 3824, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  54["SketchBlockConstraint Coincident<br>[3827, 3871, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  55["SketchBlockConstraint Coincident<br>[3874, 3915, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  59["SketchBlockConstraint Horizontal<br>[3919, 3938, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  60["SketchBlockConstraint Horizontal<br>[3941, 3963, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  68["SketchBlockConstraint Vertical<br>[3966, 3985, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  69["SketchBlockConstraint Vertical<br>[3988, 4006, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  63["SketchBlockConstraint HorizontalDistance<br>[4010, 4065, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  72["SketchBlockConstraint VerticalDistance<br>[4068, 4116, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 13 }, ExpressionStatementExpr]
  64["SketchBlockConstraint HorizontalDistance<br>[4119, 4180, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 14 }, ExpressionStatementExpr]
  73["SketchBlockConstraint VerticalDistance<br>[4183, 4252, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 15 }, ExpressionStatementExpr]
  27 <--x 1
  28 <--x 1
  29 <--x 1
  30 <--x 1
  76 --- 1
  77 --- 2
  90 <--x 2
  91 <--x 2
  92 <--x 2
  93 <--x 2
  78 --- 3
  94 <--x 3
  79 --- 4
  95 <--x 4
  76 --- 5
  96 <--x 5
  97 <--x 5
  98 <--x 5
  99 <--x 5
  35 <--x 6
  36 <--x 6
  37 <--x 6
  38 <--x 6
  77 --- 6
  39 <--x 7
  78 --- 7
  40 <--x 8
  79 --- 8
  9 --- 10
  13 --- 9
  14 --- 9
  16 --- 10
  17 --- 10
  83 x--> 11
  92 x--> 12
  18 x--> 13
  23 x--> 13
  13 <--x 27
  13 <--x 28
  13 <--x 29
  13 <--x 30
  13 ---- 76
  15 x--> 14
  19 x--> 14
  14 <--x 35
  14 <--x 36
  14 <--x 37
  14 <--x 38
  14 ---- 77
  19 --- 15
  15 --- 31
  15 --- 32
  15 --- 33
  15 --- 34
  42 --- 15
  20 --- 16
  16 --- 39
  16 --- 74
  16 ---- 78
  21 --- 17
  17 --- 40
  17 --- 75
  17 ---- 79
  23 --- 18
  18 --- 24
  18 --- 25
  18 --- 26
  18 --- 41
  43 --- 18
  19 <--x 42
  23 <--x 43
  24 <--x 27
  25 <--x 28
  26 <--x 29
  27 --- 80
  27 --- 96
  27 --- 100
  28 --- 81
  28 --- 97
  28 --- 101
  29 --- 82
  29 --- 98
  29 --- 102
  41 x--> 30
  30 --- 83
  30 --- 99
  30 --- 103
  31 <--x 35
  32 <--x 36
  33 <--x 37
  34 <--x 38
  35 --- 84
  35 --- 90
  35 --- 104
  36 --- 85
  36 --- 91
  36 --- 105
  37 --- 86
  37 --- 92
  37 --- 106
  38 --- 87
  38 --- 93
  38 --- 107
  39 --- 88
  39 --- 94
  39 --- 108
  40 --- 89
  40 --- 95
  40 --- 109
  76 --- 80
  76 --- 81
  76 --- 82
  76 --- 83
  76 --- 96
  76 --- 97
  76 --- 98
  76 --- 99
  76 --- 100
  76 --- 101
  76 --- 102
  76 --- 103
  77 --- 84
  77 --- 85
  77 --- 86
  77 --- 87
  77 --- 90
  77 --- 91
  77 --- 92
  77 --- 93
  77 --- 104
  77 --- 105
  77 --- 106
  77 --- 107
  78 --- 88
  78 --- 94
  78 --- 108
  79 --- 89
  79 --- 95
  79 --- 109
  100 --- 80
  80 x--> 100
  101 --- 81
  81 x--> 101
  102 --- 82
  82 x--> 102
  103 --- 83
  83 x--> 103
  104 --- 84
  84 x--> 104
  105 --- 85
  85 x--> 105
  106 --- 86
  86 x--> 106
  107 --- 87
  87 x--> 107
  108 --- 88
  109 --- 89
  100 --- 90
  101 --- 91
  102 --- 92
  103 --- 93
  104 --- 94
  105 --- 95
  106 --- 96
  107 --- 97
  108 --- 98
  109 --- 99
```

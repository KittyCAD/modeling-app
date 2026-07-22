```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[751, 1378, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[787, 845, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    4["Segment<br>[856, 915, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    5["Segment<br>[965, 1025, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    6["Segment<br>[1075, 1134, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path8 [Path]
    8["Path<br>[1584, 2212, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path191 [Path]
    191["Path<br>[2631, 2768, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    192["Segment<br>[2669, 2740, 0]"]
      %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path193 [Path]
    193["Path Region<br>[2781, 2820, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    194["Segment<br>[2781, 2820, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path201 [Path]
    201["Path<br>[2948, 3082, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    202["Segment<br>[2985, 3051, 0]"]
      %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path203 [Path]
    203["Path Region<br>[3095, 3133, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    204["Segment<br>[3095, 3133, 0]"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path211 [Path]
    211["Path<br>[3275, 3415, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    212["Segment<br>[3313, 3382, 0]"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path213 [Path]
    213["Path Region<br>[3428, 3467, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    214["Segment<br>[3428, 3467, 0]"]
      %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  1["Plane<br>[722, 739, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  7["Plane<br>[1447, 1484, 0]"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  9["SweepEdge Opposite"]
  10["SweepEdge Opposite"]
  11["SweepEdge Opposite"]
  12["SweepEdge Opposite"]
  13["Sweep Loft<br>[2250, 2277, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 17 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  14[Wall]
    %% face_code_ref=Missing NodePath
  15[Wall]
    %% face_code_ref=Missing NodePath
  16[Wall]
    %% face_code_ref=Missing NodePath
  17[Wall]
    %% face_code_ref=Missing NodePath
  18["Cap Start"]
    %% face_code_ref=Missing NodePath
  19["Cap End"]
    %% face_code_ref=Missing NodePath
  20["SweepEdge Adjacent"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Adjacent"]
  24["Pattern Circular<br>[2443, 2566, 0]<br>Copies: 11<br>Faces: 66<br>Edges: 132"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  25["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  26[Wall]
    %% face_code_ref=Missing NodePath
  27[Wall]
    %% face_code_ref=Missing NodePath
  28[Wall]
    %% face_code_ref=Missing NodePath
  29[Wall]
    %% face_code_ref=Missing NodePath
  30["Cap Start"]
    %% face_code_ref=Missing NodePath
  31["Cap End"]
    %% face_code_ref=Missing NodePath
  32["SweepEdge Opposite"]
  33["SweepEdge Adjacent"]
  34["SweepEdge Opposite"]
  35["SweepEdge Adjacent"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Opposite"]
  39["SweepEdge Adjacent"]
  40["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  41[Wall]
    %% face_code_ref=Missing NodePath
  42[Wall]
    %% face_code_ref=Missing NodePath
  43[Wall]
    %% face_code_ref=Missing NodePath
  44[Wall]
    %% face_code_ref=Missing NodePath
  45["Cap Start"]
    %% face_code_ref=Missing NodePath
  46["Cap End"]
    %% face_code_ref=Missing NodePath
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Opposite"]
  54["SweepEdge Adjacent"]
  55["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  56[Wall]
    %% face_code_ref=Missing NodePath
  57[Wall]
    %% face_code_ref=Missing NodePath
  58[Wall]
    %% face_code_ref=Missing NodePath
  59[Wall]
    %% face_code_ref=Missing NodePath
  60["Cap Start"]
    %% face_code_ref=Missing NodePath
  61["Cap End"]
    %% face_code_ref=Missing NodePath
  62["SweepEdge Opposite"]
  63["SweepEdge Adjacent"]
  64["SweepEdge Opposite"]
  65["SweepEdge Adjacent"]
  66["SweepEdge Opposite"]
  67["SweepEdge Adjacent"]
  68["SweepEdge Opposite"]
  69["SweepEdge Adjacent"]
  70["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  71[Wall]
    %% face_code_ref=Missing NodePath
  72[Wall]
    %% face_code_ref=Missing NodePath
  73[Wall]
    %% face_code_ref=Missing NodePath
  74[Wall]
    %% face_code_ref=Missing NodePath
  75["Cap Start"]
    %% face_code_ref=Missing NodePath
  76["Cap End"]
    %% face_code_ref=Missing NodePath
  77["SweepEdge Opposite"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Opposite"]
  80["SweepEdge Adjacent"]
  81["SweepEdge Opposite"]
  82["SweepEdge Adjacent"]
  83["SweepEdge Opposite"]
  84["SweepEdge Adjacent"]
  85["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  86[Wall]
    %% face_code_ref=Missing NodePath
  87[Wall]
    %% face_code_ref=Missing NodePath
  88[Wall]
    %% face_code_ref=Missing NodePath
  89[Wall]
    %% face_code_ref=Missing NodePath
  90["Cap Start"]
    %% face_code_ref=Missing NodePath
  91["Cap End"]
    %% face_code_ref=Missing NodePath
  92["SweepEdge Opposite"]
  93["SweepEdge Adjacent"]
  94["SweepEdge Opposite"]
  95["SweepEdge Adjacent"]
  96["SweepEdge Opposite"]
  97["SweepEdge Adjacent"]
  98["SweepEdge Opposite"]
  99["SweepEdge Adjacent"]
  100["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  101[Wall]
    %% face_code_ref=Missing NodePath
  102[Wall]
    %% face_code_ref=Missing NodePath
  103[Wall]
    %% face_code_ref=Missing NodePath
  104[Wall]
    %% face_code_ref=Missing NodePath
  105["Cap Start"]
    %% face_code_ref=Missing NodePath
  106["Cap End"]
    %% face_code_ref=Missing NodePath
  107["SweepEdge Opposite"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Opposite"]
  110["SweepEdge Adjacent"]
  111["SweepEdge Opposite"]
  112["SweepEdge Adjacent"]
  113["SweepEdge Opposite"]
  114["SweepEdge Adjacent"]
  115["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  116[Wall]
    %% face_code_ref=Missing NodePath
  117[Wall]
    %% face_code_ref=Missing NodePath
  118[Wall]
    %% face_code_ref=Missing NodePath
  119[Wall]
    %% face_code_ref=Missing NodePath
  120["Cap Start"]
    %% face_code_ref=Missing NodePath
  121["Cap End"]
    %% face_code_ref=Missing NodePath
  122["SweepEdge Opposite"]
  123["SweepEdge Adjacent"]
  124["SweepEdge Opposite"]
  125["SweepEdge Adjacent"]
  126["SweepEdge Opposite"]
  127["SweepEdge Adjacent"]
  128["SweepEdge Opposite"]
  129["SweepEdge Adjacent"]
  130["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  131[Wall]
    %% face_code_ref=Missing NodePath
  132[Wall]
    %% face_code_ref=Missing NodePath
  133[Wall]
    %% face_code_ref=Missing NodePath
  134[Wall]
    %% face_code_ref=Missing NodePath
  135["Cap Start"]
    %% face_code_ref=Missing NodePath
  136["Cap End"]
    %% face_code_ref=Missing NodePath
  137["SweepEdge Opposite"]
  138["SweepEdge Adjacent"]
  139["SweepEdge Opposite"]
  140["SweepEdge Adjacent"]
  141["SweepEdge Opposite"]
  142["SweepEdge Adjacent"]
  143["SweepEdge Opposite"]
  144["SweepEdge Adjacent"]
  145["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  146[Wall]
    %% face_code_ref=Missing NodePath
  147[Wall]
    %% face_code_ref=Missing NodePath
  148[Wall]
    %% face_code_ref=Missing NodePath
  149[Wall]
    %% face_code_ref=Missing NodePath
  150["Cap Start"]
    %% face_code_ref=Missing NodePath
  151["Cap End"]
    %% face_code_ref=Missing NodePath
  152["SweepEdge Opposite"]
  153["SweepEdge Adjacent"]
  154["SweepEdge Opposite"]
  155["SweepEdge Adjacent"]
  156["SweepEdge Opposite"]
  157["SweepEdge Adjacent"]
  158["SweepEdge Opposite"]
  159["SweepEdge Adjacent"]
  160["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  161[Wall]
    %% face_code_ref=Missing NodePath
  162[Wall]
    %% face_code_ref=Missing NodePath
  163[Wall]
    %% face_code_ref=Missing NodePath
  164[Wall]
    %% face_code_ref=Missing NodePath
  165["Cap Start"]
    %% face_code_ref=Missing NodePath
  166["Cap End"]
    %% face_code_ref=Missing NodePath
  167["SweepEdge Opposite"]
  168["SweepEdge Adjacent"]
  169["SweepEdge Opposite"]
  170["SweepEdge Adjacent"]
  171["SweepEdge Opposite"]
  172["SweepEdge Adjacent"]
  173["SweepEdge Opposite"]
  174["SweepEdge Adjacent"]
  175["Sweep Loft<br>[2443, 2566, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  176[Wall]
    %% face_code_ref=Missing NodePath
  177[Wall]
    %% face_code_ref=Missing NodePath
  178[Wall]
    %% face_code_ref=Missing NodePath
  179[Wall]
    %% face_code_ref=Missing NodePath
  180["Cap Start"]
    %% face_code_ref=Missing NodePath
  181["Cap End"]
    %% face_code_ref=Missing NodePath
  182["SweepEdge Opposite"]
  183["SweepEdge Adjacent"]
  184["SweepEdge Opposite"]
  185["SweepEdge Adjacent"]
  186["SweepEdge Opposite"]
  187["SweepEdge Adjacent"]
  188["SweepEdge Opposite"]
  189["SweepEdge Adjacent"]
  190["Plane<br>[2600, 2617, 0]"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  195["Sweep Extrusion<br>[2833, 2872, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  196[Wall]
    %% face_code_ref=Missing NodePath
  197["Cap Start"]
    %% face_code_ref=Missing NodePath
  198["Cap End"]
    %% face_code_ref=[ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  199["SweepEdge Opposite"]
  200["SweepEdge Adjacent"]
  205["Sweep Extrusion<br>[3140, 3178, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  206[Wall]
    %% face_code_ref=Missing NodePath
  207["Cap End"]
    %% face_code_ref=Missing NodePath
  208["SweepEdge Opposite"]
  209["SweepEdge Adjacent"]
  210["Plane<br>[3220, 3260, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, CallKwUnlabeledArg]
  215["Sweep Extrusion<br>[3475, 3533, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  216[Wall]
    %% face_code_ref=Missing NodePath
  217["Cap Start"]
    %% face_code_ref=Missing NodePath
  218["Cap End"]
    %% face_code_ref=Missing NodePath
  219["SweepEdge Opposite"]
  220["SweepEdge Adjacent"]
  221["CompositeSolid Subtract<br>[3564, 3593, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 32 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  222["SketchBlock<br>[751, 1378, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  223["SketchBlockConstraint Coincident<br>[918, 954, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  224["SketchBlockConstraint Coincident<br>[1028, 1064, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  225["SketchBlockConstraint Coincident<br>[1137, 1173, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  226["SketchBlockConstraint Coincident<br>[1176, 1212, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  227["SketchBlockConstraint Horizontal<br>[1215, 1232, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  228["SketchBlockConstraint Vertical<br>[1235, 1250, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  229["SketchBlockConstraint Horizontal<br>[1253, 1270, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  230["SketchBlockConstraint Distance<br>[1273, 1321, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  231["SketchBlockConstraint Distance<br>[1324, 1376, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  232["StartSketchOnPlane<br>[1546, 1571, 0]"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  233["SketchBlock<br>[1584, 2212, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  234["SketchBlockConstraint Coincident<br>[1752, 1788, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  235["SketchBlockConstraint Coincident<br>[1862, 1898, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  236["SketchBlockConstraint Coincident<br>[1971, 2007, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  237["SketchBlockConstraint Coincident<br>[2010, 2046, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  238["SketchBlockConstraint Horizontal<br>[2049, 2066, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  239["SketchBlockConstraint Vertical<br>[2069, 2084, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  240["SketchBlockConstraint Horizontal<br>[2087, 2104, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  241["SketchBlockConstraint Distance<br>[2107, 2155, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  242["SketchBlockConstraint Distance<br>[2158, 2210, 0]"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  243["SketchBlock<br>[2631, 2768, 0]"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  244["SketchBlockConstraint Diameter<br>[2743, 2766, 0]"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  245["StartSketchOnFace<br>[2899, 2935, 0]"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  246["SketchBlock<br>[2948, 3082, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  247["SketchBlockConstraint Diameter<br>[3054, 3080, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  248["StartSketchOnPlane<br>[3206, 3261, 0]"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  249["SketchBlock<br>[3275, 3415, 0]"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  250["SketchBlockConstraint Diameter<br>[3385, 3413, 0]"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 222
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 13
  2 <---x 25
  2 <---x 40
  2 <---x 55
  2 <---x 70
  2 <---x 85
  2 <---x 100
  2 <---x 115
  2 <---x 130
  2 <---x 145
  2 <---x 160
  2 <---x 175
  222 --- 2
  3 --- 9
  3 --- 14
  3 x--> 18
  3 --- 20
  3 <--x 26
  3 <--x 32
  3 <--x 33
  3 <--x 41
  3 <--x 47
  3 <--x 48
  3 <--x 56
  3 <--x 62
  3 <--x 63
  3 <--x 71
  3 <--x 77
  3 <--x 78
  3 <--x 86
  3 <--x 92
  3 <--x 93
  3 <--x 101
  3 <--x 107
  3 <--x 108
  3 <--x 116
  3 <--x 122
  3 <--x 123
  3 <--x 131
  3 <--x 137
  3 <--x 138
  3 <--x 146
  3 <--x 152
  3 <--x 153
  3 <--x 161
  3 <--x 167
  3 <--x 168
  3 <--x 176
  3 <--x 182
  3 <--x 183
  4 --- 10
  4 --- 15
  4 x--> 18
  4 --- 21
  4 <--x 27
  4 <--x 34
  4 <--x 35
  4 <--x 42
  4 <--x 49
  4 <--x 50
  4 <--x 57
  4 <--x 64
  4 <--x 65
  4 <--x 72
  4 <--x 79
  4 <--x 80
  4 <--x 87
  4 <--x 94
  4 <--x 95
  4 <--x 102
  4 <--x 109
  4 <--x 110
  4 <--x 117
  4 <--x 124
  4 <--x 125
  4 <--x 132
  4 <--x 139
  4 <--x 140
  4 <--x 147
  4 <--x 154
  4 <--x 155
  4 <--x 162
  4 <--x 169
  4 <--x 170
  4 <--x 177
  4 <--x 184
  4 <--x 185
  5 --- 11
  5 --- 16
  5 x--> 18
  5 --- 22
  5 <--x 28
  5 <--x 36
  5 <--x 37
  5 <--x 43
  5 <--x 51
  5 <--x 52
  5 <--x 58
  5 <--x 66
  5 <--x 67
  5 <--x 73
  5 <--x 81
  5 <--x 82
  5 <--x 88
  5 <--x 96
  5 <--x 97
  5 <--x 103
  5 <--x 111
  5 <--x 112
  5 <--x 118
  5 <--x 126
  5 <--x 127
  5 <--x 133
  5 <--x 141
  5 <--x 142
  5 <--x 148
  5 <--x 156
  5 <--x 157
  5 <--x 163
  5 <--x 171
  5 <--x 172
  5 <--x 178
  5 <--x 186
  5 <--x 187
  6 --- 12
  6 --- 17
  6 x--> 18
  6 --- 23
  6 <--x 29
  6 <--x 38
  6 <--x 39
  6 <--x 44
  6 <--x 53
  6 <--x 54
  6 <--x 59
  6 <--x 68
  6 <--x 69
  6 <--x 74
  6 <--x 83
  6 <--x 84
  6 <--x 89
  6 <--x 98
  6 <--x 99
  6 <--x 104
  6 <--x 113
  6 <--x 114
  6 <--x 119
  6 <--x 128
  6 <--x 129
  6 <--x 134
  6 <--x 143
  6 <--x 144
  6 <--x 149
  6 <--x 158
  6 <--x 159
  6 <--x 164
  6 <--x 173
  6 <--x 174
  6 <--x 179
  6 <--x 188
  6 <--x 189
  7 --- 8
  7 <--x 232
  7 <--x 233
  8 x--> 9
  8 x--> 10
  8 x--> 11
  8 x--> 12
  8 x---> 13
  233 --- 8
  13 --- 9
  9 --- 14
  9 x--> 19
  13 --- 10
  10 --- 15
  10 x--> 19
  13 --- 11
  11 --- 16
  11 x--> 19
  13 --- 12
  12 --- 17
  12 x--> 19
  13 --- 14
  13 --- 15
  13 --- 16
  13 --- 17
  13 --- 18
  13 --- 19
  13 --- 20
  13 --- 21
  13 --- 22
  13 --- 23
  13 --- 24
  14 --- 20
  21 <--x 14
  15 --- 21
  22 <--x 15
  16 --- 22
  23 <--x 16
  20 <--x 17
  17 --- 23
  24 x--> 25
  24 x--> 26
  24 x--> 27
  24 x--> 28
  24 x--> 29
  24 x--> 30
  24 x--> 31
  24 x--> 32
  24 x--> 33
  24 x--> 34
  24 x--> 35
  24 x--> 36
  24 x--> 37
  24 x--> 38
  24 x--> 39
  24 x--> 40
  24 x--> 41
  24 x--> 42
  24 x--> 43
  24 x--> 44
  24 x--> 45
  24 x--> 46
  24 x--> 47
  24 x--> 48
  24 x--> 49
  24 x--> 50
  24 x--> 51
  24 x--> 52
  24 x--> 53
  24 x--> 54
  24 x--> 55
  24 x--> 56
  24 x--> 57
  24 x--> 58
  24 x--> 59
  24 x--> 60
  24 x--> 61
  24 x--> 62
  24 x--> 63
  24 x--> 64
  24 x--> 65
  24 x--> 66
  24 x--> 67
  24 x--> 68
  24 x--> 69
  24 x--> 70
  24 x--> 71
  24 x--> 72
  24 x--> 73
  24 x--> 74
  24 x--> 75
  24 x--> 76
  24 x--> 77
  24 x--> 78
  24 x--> 79
  24 x--> 80
  24 x--> 81
  24 x--> 82
  24 x--> 83
  24 x--> 84
  24 x--> 85
  24 x--> 86
  24 x--> 87
  24 x--> 88
  24 x--> 89
  24 x--> 90
  24 x--> 91
  24 x--> 92
  24 x--> 93
  24 x--> 94
  24 x--> 95
  24 x--> 96
  24 x--> 97
  24 x--> 98
  24 x--> 99
  24 x--> 100
  24 x--> 101
  24 x--> 102
  24 x--> 103
  24 x--> 104
  24 x--> 105
  24 x--> 106
  24 x--> 107
  24 x--> 108
  24 x--> 109
  24 x--> 110
  24 x--> 111
  24 x--> 112
  24 x--> 113
  24 x--> 114
  24 x--> 115
  24 x--> 116
  24 x--> 117
  24 x--> 118
  24 x--> 119
  24 x--> 120
  24 x--> 121
  24 x--> 122
  24 x--> 123
  24 x--> 124
  24 x--> 125
  24 x--> 126
  24 x--> 127
  24 x--> 128
  24 x--> 129
  24 x--> 130
  24 x--> 131
  24 x--> 132
  24 x--> 133
  24 x--> 134
  24 x--> 135
  24 x--> 136
  24 x--> 137
  24 x--> 138
  24 x--> 139
  24 x--> 140
  24 x--> 141
  24 x--> 142
  24 x--> 143
  24 x--> 144
  24 x--> 145
  24 x--> 146
  24 x--> 147
  24 x--> 148
  24 x--> 149
  24 x--> 150
  24 x--> 151
  24 x--> 152
  24 x--> 153
  24 x--> 154
  24 x--> 155
  24 x--> 156
  24 x--> 157
  24 x--> 158
  24 x--> 159
  24 x--> 160
  24 x--> 161
  24 x--> 162
  24 x--> 163
  24 x--> 164
  24 x--> 165
  24 x--> 166
  24 x--> 167
  24 x--> 168
  24 x--> 169
  24 x--> 170
  24 x--> 171
  24 x--> 172
  24 x--> 173
  24 x--> 174
  24 x--> 175
  24 x--> 176
  24 x--> 177
  24 x--> 178
  24 x--> 179
  24 x--> 180
  24 x--> 181
  24 x--> 182
  24 x--> 183
  24 x--> 184
  24 x--> 185
  24 x--> 186
  24 x--> 187
  24 x--> 188
  24 x--> 189
  25 --- 26
  25 --- 27
  25 --- 28
  25 --- 29
  25 --- 30
  25 --- 31
  25 --- 32
  25 --- 33
  25 --- 34
  25 --- 35
  25 --- 36
  25 --- 37
  25 --- 38
  25 --- 39
  26 --- 32
  26 --- 33
  35 <--x 26
  27 --- 34
  27 --- 35
  37 <--x 27
  28 --- 36
  28 --- 37
  39 <--x 28
  33 <--x 29
  29 --- 38
  29 --- 39
  32 <--x 31
  34 <--x 31
  36 <--x 31
  38 <--x 31
  40 --- 41
  40 --- 42
  40 --- 43
  40 --- 44
  40 --- 45
  40 --- 46
  40 --- 47
  40 --- 48
  40 --- 49
  40 --- 50
  40 --- 51
  40 --- 52
  40 --- 53
  40 --- 54
  41 --- 47
  41 --- 48
  50 <--x 41
  42 --- 49
  42 --- 50
  52 <--x 42
  43 --- 51
  43 --- 52
  54 <--x 43
  48 <--x 44
  44 --- 53
  44 --- 54
  47 <--x 46
  49 <--x 46
  51 <--x 46
  53 <--x 46
  55 --- 56
  55 --- 57
  55 --- 58
  55 --- 59
  55 --- 60
  55 --- 61
  55 --- 62
  55 --- 63
  55 --- 64
  55 --- 65
  55 --- 66
  55 --- 67
  55 --- 68
  55 --- 69
  56 --- 62
  56 --- 63
  65 <--x 56
  57 --- 64
  57 --- 65
  67 <--x 57
  58 --- 66
  58 --- 67
  69 <--x 58
  63 <--x 59
  59 --- 68
  59 --- 69
  62 <--x 61
  64 <--x 61
  66 <--x 61
  68 <--x 61
  70 --- 71
  70 --- 72
  70 --- 73
  70 --- 74
  70 --- 75
  70 --- 76
  70 --- 77
  70 --- 78
  70 --- 79
  70 --- 80
  70 --- 81
  70 --- 82
  70 --- 83
  70 --- 84
  71 --- 77
  71 --- 78
  80 <--x 71
  72 --- 79
  72 --- 80
  82 <--x 72
  73 --- 81
  73 --- 82
  84 <--x 73
  78 <--x 74
  74 --- 83
  74 --- 84
  77 <--x 76
  79 <--x 76
  81 <--x 76
  83 <--x 76
  85 --- 86
  85 --- 87
  85 --- 88
  85 --- 89
  85 --- 90
  85 --- 91
  85 --- 92
  85 --- 93
  85 --- 94
  85 --- 95
  85 --- 96
  85 --- 97
  85 --- 98
  85 --- 99
  86 --- 92
  86 --- 93
  95 <--x 86
  87 --- 94
  87 --- 95
  97 <--x 87
  88 --- 96
  88 --- 97
  99 <--x 88
  93 <--x 89
  89 --- 98
  89 --- 99
  92 <--x 91
  94 <--x 91
  96 <--x 91
  98 <--x 91
  100 --- 101
  100 --- 102
  100 --- 103
  100 --- 104
  100 --- 105
  100 --- 106
  100 --- 107
  100 --- 108
  100 --- 109
  100 --- 110
  100 --- 111
  100 --- 112
  100 --- 113
  100 --- 114
  101 --- 107
  101 --- 108
  110 <--x 101
  102 --- 109
  102 --- 110
  112 <--x 102
  103 --- 111
  103 --- 112
  114 <--x 103
  108 <--x 104
  104 --- 113
  104 --- 114
  107 <--x 106
  109 <--x 106
  111 <--x 106
  113 <--x 106
  115 --- 116
  115 --- 117
  115 --- 118
  115 --- 119
  115 --- 120
  115 --- 121
  115 --- 122
  115 --- 123
  115 --- 124
  115 --- 125
  115 --- 126
  115 --- 127
  115 --- 128
  115 --- 129
  116 --- 122
  116 --- 123
  125 <--x 116
  117 --- 124
  117 --- 125
  127 <--x 117
  118 --- 126
  118 --- 127
  129 <--x 118
  123 <--x 119
  119 --- 128
  119 --- 129
  122 <--x 121
  124 <--x 121
  126 <--x 121
  128 <--x 121
  130 --- 131
  130 --- 132
  130 --- 133
  130 --- 134
  130 --- 135
  130 --- 136
  130 --- 137
  130 --- 138
  130 --- 139
  130 --- 140
  130 --- 141
  130 --- 142
  130 --- 143
  130 --- 144
  131 --- 137
  131 --- 138
  140 <--x 131
  132 --- 139
  132 --- 140
  142 <--x 132
  133 --- 141
  133 --- 142
  144 <--x 133
  138 <--x 134
  134 --- 143
  134 --- 144
  137 <--x 136
  139 <--x 136
  141 <--x 136
  143 <--x 136
  145 --- 146
  145 --- 147
  145 --- 148
  145 --- 149
  145 --- 150
  145 --- 151
  145 --- 152
  145 --- 153
  145 --- 154
  145 --- 155
  145 --- 156
  145 --- 157
  145 --- 158
  145 --- 159
  146 --- 152
  146 --- 153
  155 <--x 146
  147 --- 154
  147 --- 155
  157 <--x 147
  148 --- 156
  148 --- 157
  159 <--x 148
  153 <--x 149
  149 --- 158
  149 --- 159
  152 <--x 151
  154 <--x 151
  156 <--x 151
  158 <--x 151
  160 --- 161
  160 --- 162
  160 --- 163
  160 --- 164
  160 --- 165
  160 --- 166
  160 --- 167
  160 --- 168
  160 --- 169
  160 --- 170
  160 --- 171
  160 --- 172
  160 --- 173
  160 --- 174
  161 --- 167
  161 --- 168
  170 <--x 161
  162 --- 169
  162 --- 170
  172 <--x 162
  163 --- 171
  163 --- 172
  174 <--x 163
  168 <--x 164
  164 --- 173
  164 --- 174
  167 <--x 166
  169 <--x 166
  171 <--x 166
  173 <--x 166
  175 --- 176
  175 --- 177
  175 --- 178
  175 --- 179
  175 --- 180
  175 --- 181
  175 --- 182
  175 --- 183
  175 --- 184
  175 --- 185
  175 --- 186
  175 --- 187
  175 --- 188
  175 --- 189
  176 --- 182
  176 --- 183
  185 <--x 176
  177 --- 184
  177 --- 185
  187 <--x 177
  178 --- 186
  178 --- 187
  189 <--x 178
  183 <--x 179
  179 --- 188
  179 --- 189
  182 <--x 181
  184 <--x 181
  186 <--x 181
  188 <--x 181
  190 --- 191
  190 <--x 193
  190 <--x 243
  191 --- 192
  191 <--x 193
  243 --- 191
  192 <--x 194
  193 <--x 194
  193 ---- 195
  193 --- 221
  194 --- 196
  194 x--> 198
  194 --- 199
  194 --- 200
  195 --- 196
  195 --- 197
  195 --- 198
  195 --- 199
  195 --- 200
  196 --- 199
  196 --- 200
  199 <--x 197
  198 --- 201
  198 <--x 203
  204 <--x 198
  198 <--x 245
  198 <--x 246
  201 --- 202
  201 <--x 203
  246 --- 201
  202 <--x 204
  203 <--x 204
  203 ---- 205
  204 --- 206
  204 --- 208
  204 --- 209
  205 --- 206
  205 --- 207
  205 --- 208
  205 --- 209
  206 --- 208
  206 --- 209
  208 <--x 207
  210 --- 211
  210 <--x 213
  210 <--x 248
  210 <--x 249
  211 --- 212
  211 <--x 213
  249 --- 211
  212 <--x 214
  213 <--x 214
  213 ---- 215
  213 --- 221
  214 --- 216
  214 x--> 217
  214 --- 219
  214 --- 220
  215 --- 216
  215 --- 217
  215 --- 218
  215 --- 219
  215 --- 220
  216 --- 219
  216 --- 220
  219 <--x 218
```

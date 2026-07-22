```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[666, 1101, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[741, 807, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    4["Segment<br>[935, 1000, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path5 [Path]
    5["Path Region<br>[1158, 1212, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    6["Segment<br>[1158, 1212, 0]"]
      %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path14 [Path]
    14["Path<br>[1335, 1753, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    15["Segment<br>[1362, 1455, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    16["Segment<br>[1502, 1570, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path17 [Path]
    17["Path Region<br>[1840, 1889, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    18["Segment<br>[1840, 1889, 0]"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    19["Segment<br>[1840, 1889, 0]"]
      %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path42 [Path]
    42["Path<br>[2216, 3082, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    43["Segment<br>[2243, 2342, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    44["Segment<br>[2428, 2500, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    45["Segment<br>[2549, 2620, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    46["Segment<br>[2670, 2740, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path47 [Path]
    47["Path Region<br>[3130, 3167, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    48["Segment<br>[3130, 3167, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    49["Segment<br>[3130, 3167, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    50["Segment<br>[3130, 3167, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    51["Segment<br>[3130, 3167, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path144 [Path]
    144["Path<br>[3521, 4272, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    145["Segment<br>[3551, 3619, 0]"]
      %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path146 [Path]
    146["Path Region<br>[4326, 4365, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    147["Segment<br>[4326, 4365, 0]"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path210 [Path]
    210["Path<br>[4674, 5129, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    211["Segment<br>[4749, 4815, 0]"]
      %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    212["Segment<br>[4934, 5000, 0]"]
      %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path213 [Path]
    213["Path Region<br>[5147, 5204, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    214["Segment<br>[5147, 5204, 0]"]
      %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  1["Plane<br>[678, 725, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockArgs]
  7["Sweep Extrusion<br>[1226, 1278, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  8[Wall]
    %% face_code_ref=Missing NodePath
  9["Cap Start"]
    %% face_code_ref=Missing NodePath
  10["Cap End"]
    %% face_code_ref=Missing NodePath
  11["SweepEdge Opposite"]
  12["SweepEdge Adjacent"]
  13["Plane<br>[1335, 1753, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  20["Sweep Revolve<br>[1901, 1946, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  21[Wall]
    %% face_code_ref=Missing NodePath
  22["Pattern Circular<br>[2060, 2148, 0]<br>Copies: 9<br>Faces: 9<br>Edges: 9"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  23["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  24[Wall]
    %% face_code_ref=Missing NodePath
  25["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  26[Wall]
    %% face_code_ref=Missing NodePath
  27["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  28[Wall]
    %% face_code_ref=Missing NodePath
  29["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  30[Wall]
    %% face_code_ref=Missing NodePath
  31["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32[Wall]
    %% face_code_ref=Missing NodePath
  33["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  34[Wall]
    %% face_code_ref=Missing NodePath
  35["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  36[Wall]
    %% face_code_ref=Missing NodePath
  37["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  38[Wall]
    %% face_code_ref=Missing NodePath
  39["Sweep Revolve<br>[2060, 2148, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  40[Wall]
    %% face_code_ref=Missing NodePath
  41["Plane<br>[2216, 3082, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  52["Sweep Revolve<br>[3184, 3218, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  53[Wall]
    %% face_code_ref=Missing NodePath
  54[Wall]
    %% face_code_ref=Missing NodePath
  55[Wall]
    %% face_code_ref=Missing NodePath
  56[Wall]
    %% face_code_ref=Missing NodePath
  57["SweepEdge Adjacent"]
  58["SweepEdge Adjacent"]
  59["SweepEdge Adjacent"]
  60["SweepEdge Adjacent"]
  61["Pattern Circular<br>[3356, 3449, 0]<br>Copies: 9<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  62["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  63[Wall]
    %% face_code_ref=Missing NodePath
  64[Wall]
    %% face_code_ref=Missing NodePath
  65[Wall]
    %% face_code_ref=Missing NodePath
  66[Wall]
    %% face_code_ref=Missing NodePath
  67["SweepEdge Adjacent"]
  68["SweepEdge Adjacent"]
  69["SweepEdge Adjacent"]
  70["SweepEdge Adjacent"]
  71["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  72[Wall]
    %% face_code_ref=Missing NodePath
  73[Wall]
    %% face_code_ref=Missing NodePath
  74[Wall]
    %% face_code_ref=Missing NodePath
  75[Wall]
    %% face_code_ref=Missing NodePath
  76["SweepEdge Adjacent"]
  77["SweepEdge Adjacent"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Adjacent"]
  80["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  81[Wall]
    %% face_code_ref=Missing NodePath
  82[Wall]
    %% face_code_ref=Missing NodePath
  83[Wall]
    %% face_code_ref=Missing NodePath
  84[Wall]
    %% face_code_ref=Missing NodePath
  85["SweepEdge Adjacent"]
  86["SweepEdge Adjacent"]
  87["SweepEdge Adjacent"]
  88["SweepEdge Adjacent"]
  89["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  90[Wall]
    %% face_code_ref=Missing NodePath
  91[Wall]
    %% face_code_ref=Missing NodePath
  92[Wall]
    %% face_code_ref=Missing NodePath
  93[Wall]
    %% face_code_ref=Missing NodePath
  94["SweepEdge Adjacent"]
  95["SweepEdge Adjacent"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Adjacent"]
  98["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  99[Wall]
    %% face_code_ref=Missing NodePath
  100[Wall]
    %% face_code_ref=Missing NodePath
  101[Wall]
    %% face_code_ref=Missing NodePath
  102[Wall]
    %% face_code_ref=Missing NodePath
  103["SweepEdge Adjacent"]
  104["SweepEdge Adjacent"]
  105["SweepEdge Adjacent"]
  106["SweepEdge Adjacent"]
  107["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  108[Wall]
    %% face_code_ref=Missing NodePath
  109[Wall]
    %% face_code_ref=Missing NodePath
  110[Wall]
    %% face_code_ref=Missing NodePath
  111[Wall]
    %% face_code_ref=Missing NodePath
  112["SweepEdge Adjacent"]
  113["SweepEdge Adjacent"]
  114["SweepEdge Adjacent"]
  115["SweepEdge Adjacent"]
  116["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  117[Wall]
    %% face_code_ref=Missing NodePath
  118[Wall]
    %% face_code_ref=Missing NodePath
  119[Wall]
    %% face_code_ref=Missing NodePath
  120[Wall]
    %% face_code_ref=Missing NodePath
  121["SweepEdge Adjacent"]
  122["SweepEdge Adjacent"]
  123["SweepEdge Adjacent"]
  124["SweepEdge Adjacent"]
  125["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  126[Wall]
    %% face_code_ref=Missing NodePath
  127[Wall]
    %% face_code_ref=Missing NodePath
  128[Wall]
    %% face_code_ref=Missing NodePath
  129[Wall]
    %% face_code_ref=Missing NodePath
  130["SweepEdge Adjacent"]
  131["SweepEdge Adjacent"]
  132["SweepEdge Adjacent"]
  133["SweepEdge Adjacent"]
  134["Sweep Revolve<br>[3356, 3449, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  135[Wall]
    %% face_code_ref=Missing NodePath
  136[Wall]
    %% face_code_ref=Missing NodePath
  137[Wall]
    %% face_code_ref=Missing NodePath
  138[Wall]
    %% face_code_ref=Missing NodePath
  139["SweepEdge Adjacent"]
  140["SweepEdge Adjacent"]
  141["SweepEdge Adjacent"]
  142["SweepEdge Adjacent"]
  143["Plane<br>[3521, 4272, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  148["Sweep Revolve<br>[4380, 4424, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  149[Wall]
    %% face_code_ref=Missing NodePath
  150["Cap Start"]
    %% face_code_ref=Missing NodePath
  151["Cap End"]
    %% face_code_ref=Missing NodePath
  152["SweepEdge Opposite"]
  153["SweepEdge Adjacent"]
  154["Pattern Circular<br>[4518, 4609, 0]<br>Copies: 9<br>Faces: 27<br>Edges: 27"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  155["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  156[Wall]
    %% face_code_ref=Missing NodePath
  157["Cap Start"]
    %% face_code_ref=Missing NodePath
  158["Cap End"]
    %% face_code_ref=Missing NodePath
  159["SweepEdge Opposite"]
  160["SweepEdge Adjacent"]
  161["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  162[Wall]
    %% face_code_ref=Missing NodePath
  163["Cap Start"]
    %% face_code_ref=Missing NodePath
  164["Cap End"]
    %% face_code_ref=Missing NodePath
  165["SweepEdge Opposite"]
  166["SweepEdge Adjacent"]
  167["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  168[Wall]
    %% face_code_ref=Missing NodePath
  169["Cap Start"]
    %% face_code_ref=Missing NodePath
  170["Cap End"]
    %% face_code_ref=Missing NodePath
  171["SweepEdge Opposite"]
  172["SweepEdge Adjacent"]
  173["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  174[Wall]
    %% face_code_ref=Missing NodePath
  175["Cap Start"]
    %% face_code_ref=Missing NodePath
  176["Cap End"]
    %% face_code_ref=Missing NodePath
  177["SweepEdge Opposite"]
  178["SweepEdge Adjacent"]
  179["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  180[Wall]
    %% face_code_ref=Missing NodePath
  181["Cap Start"]
    %% face_code_ref=Missing NodePath
  182["Cap End"]
    %% face_code_ref=Missing NodePath
  183["SweepEdge Opposite"]
  184["SweepEdge Adjacent"]
  185["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  186[Wall]
    %% face_code_ref=Missing NodePath
  187["Cap Start"]
    %% face_code_ref=Missing NodePath
  188["Cap End"]
    %% face_code_ref=Missing NodePath
  189["SweepEdge Opposite"]
  190["SweepEdge Adjacent"]
  191["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  192[Wall]
    %% face_code_ref=Missing NodePath
  193["Cap Start"]
    %% face_code_ref=Missing NodePath
  194["Cap End"]
    %% face_code_ref=Missing NodePath
  195["SweepEdge Opposite"]
  196["SweepEdge Adjacent"]
  197["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  198[Wall]
    %% face_code_ref=Missing NodePath
  199["Cap Start"]
    %% face_code_ref=Missing NodePath
  200["Cap End"]
    %% face_code_ref=Missing NodePath
  201["SweepEdge Opposite"]
  202["SweepEdge Adjacent"]
  203["Sweep Revolve<br>[4518, 4609, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  204[Wall]
    %% face_code_ref=Missing NodePath
  205["Cap Start"]
    %% face_code_ref=Missing NodePath
  206["Cap End"]
    %% face_code_ref=Missing NodePath
  207["SweepEdge Opposite"]
  208["SweepEdge Adjacent"]
  209["Plane<br>[4686, 4733, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockArgs]
  215["Sweep Extrusion<br>[5219, 5268, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 32 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  216[Wall]
    %% face_code_ref=Missing NodePath
  217["Cap Start"]
    %% face_code_ref=Missing NodePath
  218["Cap End"]
    %% face_code_ref=Missing NodePath
  219["SweepEdge Opposite"]
  220["SweepEdge Adjacent"]
  221["SketchBlock<br>[666, 1101, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  222["SketchBlockConstraint Distance<br>[810, 883, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  223["SketchBlockConstraint Coincident<br>[886, 922, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  224["SketchBlockConstraint Distance<br>[1003, 1060, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  225["SketchBlockConstraint Coincident<br>[1063, 1099, 0]"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  226["SketchBlock<br>[1335, 1753, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  227["SketchBlockConstraint Coincident<br>[1458, 1491, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  228["SketchBlockConstraint Horizontal<br>[1573, 1590, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  229["SketchBlockConstraint Coincident<br>[1593, 1628, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  230["SketchBlockConstraint Coincident<br>[1631, 1666, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  231["SketchBlockConstraint Coincident<br>[1669, 1701, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  232["SketchBlockConstraint Distance<br>[1704, 1751, 0]"]
    %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  233["SketchBlock<br>[2216, 3082, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  234["SketchBlockConstraint Coincident<br>[2345, 2378, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  235["SketchBlockConstraint Coincident<br>[2381, 2417, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  236["SketchBlockConstraint Coincident<br>[2503, 2538, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  237["SketchBlockConstraint Coincident<br>[2623, 2659, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  238["SketchBlockConstraint Coincident<br>[2743, 2779, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  239["SketchBlockConstraint Coincident<br>[2782, 2817, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  240["SketchBlockConstraint Vertical<br>[2820, 2835, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  241["SketchBlockConstraint Vertical<br>[2838, 2853, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  242["SketchBlockConstraint Horizontal<br>[2856, 2873, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  243["SketchBlockConstraint LinesEqualLength<br>[2876, 2903, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 13 }, ExpressionStatementExpr]
  244["SketchBlockConstraint Distance<br>[2906, 2956, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 14 }, ExpressionStatementExpr]
  245["SketchBlockConstraint HorizontalDistance<br>[2959, 3017, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 15 }, ExpressionStatementExpr]
  246["SketchBlockConstraint VerticalDistance<br>[3020, 3080, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 16 }, ExpressionStatementExpr]
  247["SketchBlock<br>[3521, 4272, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  248["SketchBlockConstraint Coincident<br>[3722, 3763, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  249["SketchBlockConstraint Coincident<br>[3766, 3813, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  250["SketchBlockConstraint Horizontal<br>[3816, 3841, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  251["SketchBlockConstraint HorizontalDistance<br>[3844, 3952, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  252["SketchBlockConstraint Coincident<br>[4058, 4110, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  253["SketchBlockConstraint Coincident<br>[4113, 4159, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  254["SketchBlockConstraint Horizontal<br>[4162, 4187, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  255["SketchBlockConstraint HorizontalDistance<br>[4190, 4270, 0]"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  256["SketchBlock<br>[4674, 5129, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  257["SketchBlockConstraint Coincident<br>[4818, 4854, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  258["SketchBlockConstraint Distance<br>[4857, 4921, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  259["SketchBlockConstraint Coincident<br>[5003, 5039, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  260["SketchBlockConstraint Distance<br>[5042, 5127, 0]"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 5
  1 <--x 221
  2 --- 3
  2 --- 4
  2 <--x 5
  221 --- 2
  3 <--x 6
  5 <--x 6
  5 ---- 7
  6 --- 8
  6 x--> 9
  6 --- 11
  6 --- 12
  7 --- 8
  7 --- 9
  7 --- 10
  7 --- 11
  7 --- 12
  8 --- 11
  8 --- 12
  11 <--x 10
  13 --- 14
  13 <--x 17
  13 <--x 226
  14 --- 15
  14 --- 16
  14 <--x 17
  226 --- 14
  15 <--x 18
  16 <--x 19
  17 <--x 18
  17 <--x 19
  17 ---- 20
  17 --- 22
  17 <---x 23
  17 <---x 25
  17 <---x 27
  17 <---x 29
  17 <---x 31
  17 <---x 33
  17 <---x 35
  17 <---x 37
  17 <---x 39
  20 <--x 19
  19 --- 21
  20 --- 21
  20 x--> 22
  22 x--> 23
  22 x--> 24
  22 x--> 25
  22 x--> 26
  22 x--> 27
  22 x--> 28
  22 x--> 29
  22 x--> 30
  22 x--> 31
  22 x--> 32
  22 x--> 33
  22 x--> 34
  22 x--> 35
  22 x--> 36
  22 x--> 37
  22 x--> 38
  22 x--> 39
  22 x--> 40
  23 --- 24
  25 --- 26
  27 --- 28
  29 --- 30
  31 --- 32
  33 --- 34
  35 --- 36
  37 --- 38
  39 --- 40
  41 --- 42
  41 <--x 47
  41 <--x 233
  42 --- 43
  42 --- 44
  42 --- 45
  42 --- 46
  42 <--x 47
  233 --- 42
  43 <--x 48
  44 <--x 49
  45 <--x 50
  46 <--x 51
  47 <--x 48
  47 <--x 49
  47 <--x 50
  47 <--x 51
  47 ---- 52
  47 --- 61
  47 <---x 62
  47 <---x 71
  47 <---x 80
  47 <---x 89
  47 <---x 98
  47 <---x 107
  47 <---x 116
  47 <---x 125
  47 <---x 134
  52 <--x 48
  48 --- 53
  48 --- 57
  52 <--x 49
  49 --- 54
  49 --- 58
  52 <--x 50
  50 --- 55
  50 --- 59
  52 <--x 51
  51 --- 56
  51 --- 60
  52 --- 53
  52 --- 54
  52 --- 55
  52 --- 56
  52 --- 57
  52 --- 58
  52 --- 59
  52 --- 60
  52 x--> 61
  53 --- 57
  60 <--x 53
  57 <--x 54
  54 --- 58
  58 <--x 55
  55 --- 59
  59 <--x 56
  56 --- 60
  61 x--> 62
  61 x--> 63
  61 x--> 64
  61 x--> 65
  61 x--> 66
  61 x--> 67
  61 x--> 68
  61 x--> 69
  61 x--> 70
  61 x--> 71
  61 x--> 72
  61 x--> 73
  61 x--> 74
  61 x--> 75
  61 x--> 76
  61 x--> 77
  61 x--> 78
  61 x--> 79
  61 x--> 80
  61 x--> 81
  61 x--> 82
  61 x--> 83
  61 x--> 84
  61 x--> 85
  61 x--> 86
  61 x--> 87
  61 x--> 88
  61 x--> 89
  61 x--> 90
  61 x--> 91
  61 x--> 92
  61 x--> 93
  61 x--> 94
  61 x--> 95
  61 x--> 96
  61 x--> 97
  61 x--> 98
  61 x--> 99
  61 x--> 100
  61 x--> 101
  61 x--> 102
  61 x--> 103
  61 x--> 104
  61 x--> 105
  61 x--> 106
  61 x--> 107
  61 x--> 108
  61 x--> 109
  61 x--> 110
  61 x--> 111
  61 x--> 112
  61 x--> 113
  61 x--> 114
  61 x--> 115
  61 x--> 116
  61 x--> 117
  61 x--> 118
  61 x--> 119
  61 x--> 120
  61 x--> 121
  61 x--> 122
  61 x--> 123
  61 x--> 124
  61 x--> 125
  61 x--> 126
  61 x--> 127
  61 x--> 128
  61 x--> 129
  61 x--> 130
  61 x--> 131
  61 x--> 132
  61 x--> 133
  61 x--> 134
  61 x--> 135
  61 x--> 136
  61 x--> 137
  61 x--> 138
  61 x--> 139
  61 x--> 140
  61 x--> 141
  61 x--> 142
  62 --- 63
  62 --- 64
  62 --- 65
  62 --- 66
  62 --- 67
  62 --- 68
  62 --- 69
  62 --- 70
  63 --- 67
  70 <--x 63
  67 <--x 64
  64 --- 68
  68 <--x 65
  65 --- 69
  69 <--x 66
  66 --- 70
  71 --- 72
  71 --- 73
  71 --- 74
  71 --- 75
  71 --- 76
  71 --- 77
  71 --- 78
  71 --- 79
  72 --- 76
  79 <--x 72
  76 <--x 73
  73 --- 77
  77 <--x 74
  74 --- 78
  78 <--x 75
  75 --- 79
  80 --- 81
  80 --- 82
  80 --- 83
  80 --- 84
  80 --- 85
  80 --- 86
  80 --- 87
  80 --- 88
  81 --- 85
  88 <--x 81
  85 <--x 82
  82 --- 86
  86 <--x 83
  83 --- 87
  87 <--x 84
  84 --- 88
  89 --- 90
  89 --- 91
  89 --- 92
  89 --- 93
  89 --- 94
  89 --- 95
  89 --- 96
  89 --- 97
  90 --- 94
  97 <--x 90
  94 <--x 91
  91 --- 95
  95 <--x 92
  92 --- 96
  96 <--x 93
  93 --- 97
  98 --- 99
  98 --- 100
  98 --- 101
  98 --- 102
  98 --- 103
  98 --- 104
  98 --- 105
  98 --- 106
  99 --- 103
  106 <--x 99
  103 <--x 100
  100 --- 104
  104 <--x 101
  101 --- 105
  105 <--x 102
  102 --- 106
  107 --- 108
  107 --- 109
  107 --- 110
  107 --- 111
  107 --- 112
  107 --- 113
  107 --- 114
  107 --- 115
  108 --- 112
  115 <--x 108
  112 <--x 109
  109 --- 113
  113 <--x 110
  110 --- 114
  114 <--x 111
  111 --- 115
  116 --- 117
  116 --- 118
  116 --- 119
  116 --- 120
  116 --- 121
  116 --- 122
  116 --- 123
  116 --- 124
  117 --- 121
  124 <--x 117
  121 <--x 118
  118 --- 122
  122 <--x 119
  119 --- 123
  123 <--x 120
  120 --- 124
  125 --- 126
  125 --- 127
  125 --- 128
  125 --- 129
  125 --- 130
  125 --- 131
  125 --- 132
  125 --- 133
  126 --- 130
  133 <--x 126
  130 <--x 127
  127 --- 131
  131 <--x 128
  128 --- 132
  132 <--x 129
  129 --- 133
  134 --- 135
  134 --- 136
  134 --- 137
  134 --- 138
  134 --- 139
  134 --- 140
  134 --- 141
  134 --- 142
  135 --- 139
  142 <--x 135
  139 <--x 136
  136 --- 140
  140 <--x 137
  137 --- 141
  141 <--x 138
  138 --- 142
  143 --- 144
  143 <--x 146
  143 <--x 247
  144 --- 145
  144 <--x 146
  247 --- 144
  145 <--x 147
  146 <--x 147
  146 ---- 148
  146 --- 154
  146 <---x 155
  146 <---x 161
  146 <---x 167
  146 <---x 173
  146 <---x 179
  146 <---x 185
  146 <---x 191
  146 <---x 197
  146 <---x 203
  147 --- 149
  147 x--> 150
  147 --- 152
  147 --- 153
  147 <--x 156
  147 <--x 159
  147 <--x 160
  147 <--x 162
  147 <--x 165
  147 <--x 166
  147 <--x 168
  147 <--x 171
  147 <--x 172
  147 <--x 174
  147 <--x 177
  147 <--x 178
  147 <--x 180
  147 <--x 183
  147 <--x 184
  147 <--x 186
  147 <--x 189
  147 <--x 190
  147 <--x 192
  147 <--x 195
  147 <--x 196
  147 <--x 198
  147 <--x 201
  147 <--x 202
  147 <--x 204
  147 <--x 207
  147 <--x 208
  148 --- 149
  148 --- 150
  148 --- 151
  148 --- 152
  148 --- 153
  148 x--> 154
  149 --- 152
  149 --- 153
  152 <--x 151
  154 x--> 155
  154 x--> 156
  154 x--> 157
  154 x--> 158
  154 x--> 159
  154 x--> 160
  154 x--> 161
  154 x--> 162
  154 x--> 163
  154 x--> 164
  154 x--> 165
  154 x--> 166
  154 x--> 167
  154 x--> 168
  154 x--> 169
  154 x--> 170
  154 x--> 171
  154 x--> 172
  154 x--> 173
  154 x--> 174
  154 x--> 175
  154 x--> 176
  154 x--> 177
  154 x--> 178
  154 x--> 179
  154 x--> 180
  154 x--> 181
  154 x--> 182
  154 x--> 183
  154 x--> 184
  154 x--> 185
  154 x--> 186
  154 x--> 187
  154 x--> 188
  154 x--> 189
  154 x--> 190
  154 x--> 191
  154 x--> 192
  154 x--> 193
  154 x--> 194
  154 x--> 195
  154 x--> 196
  154 x--> 197
  154 x--> 198
  154 x--> 199
  154 x--> 200
  154 x--> 201
  154 x--> 202
  154 x--> 203
  154 x--> 204
  154 x--> 205
  154 x--> 206
  154 x--> 207
  154 x--> 208
  155 --- 156
  155 --- 157
  155 --- 158
  155 --- 159
  155 --- 160
  156 --- 159
  156 --- 160
  159 <--x 158
  161 --- 162
  161 --- 163
  161 --- 164
  161 --- 165
  161 --- 166
  162 --- 165
  162 --- 166
  165 <--x 164
  167 --- 168
  167 --- 169
  167 --- 170
  167 --- 171
  167 --- 172
  168 --- 171
  168 --- 172
  171 <--x 170
  173 --- 174
  173 --- 175
  173 --- 176
  173 --- 177
  173 --- 178
  174 --- 177
  174 --- 178
  177 <--x 176
  179 --- 180
  179 --- 181
  179 --- 182
  179 --- 183
  179 --- 184
  180 --- 183
  180 --- 184
  183 <--x 182
  185 --- 186
  185 --- 187
  185 --- 188
  185 --- 189
  185 --- 190
  186 --- 189
  186 --- 190
  189 <--x 188
  191 --- 192
  191 --- 193
  191 --- 194
  191 --- 195
  191 --- 196
  192 --- 195
  192 --- 196
  195 <--x 194
  197 --- 198
  197 --- 199
  197 --- 200
  197 --- 201
  197 --- 202
  198 --- 201
  198 --- 202
  201 <--x 200
  203 --- 204
  203 --- 205
  203 --- 206
  203 --- 207
  203 --- 208
  204 --- 207
  204 --- 208
  207 <--x 206
  209 --- 210
  209 <--x 213
  209 <--x 256
  210 --- 211
  210 --- 212
  210 <--x 213
  256 --- 210
  211 <--x 214
  213 <--x 214
  213 ---- 215
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

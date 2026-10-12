```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[602, 1092, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[735, 800, 0]"]
      %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path4 [Path]
    4["Path Region<br>[1111, 1155, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    5["Segment<br>[1111, 1155, 0]"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path13 [Path]
    13["Path<br>[1302, 5925, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    14["Segment<br>[2292, 2354, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    15["Segment<br>[2373, 2435, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    16["Segment<br>[2448, 2544, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    17["Segment<br>[2562, 2628, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    18["Segment<br>[2645, 2741, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    19["Segment<br>[2754, 2820, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    20["Segment<br>[2837, 2933, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    21["Segment<br>[2951, 3015, 0]"]
      %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path22 [Path]
    22["Path Region<br>[5940, 6015, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    23["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    24["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    25["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    26["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    27["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    28["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    29["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    30["Segment<br>[5940, 6015, 0]"]
      %% [ProgramBodyItem { index: 13 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path46 [Path]
    46["Path Region<br>[6168, 6185, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    47["Segment<br>[6168, 6185, 0]"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    55["Segment<br>[6191, 6272, 0]"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    62["Segment<br>[6191, 6272, 0]"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    69["Segment<br>[6191, 6272, 0]"]
      %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  end
  subgraph path77 [Path]
    77["Path<br>[6424, 6958, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    78["Segment<br>[6565, 6630, 0]"]
      %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path79 [Path]
    79["Path Region<br>[6976, 7024, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    80["Segment<br>[6976, 7024, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path88 [Path]
    88["Path<br>[7195, 8959, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    89["Segment<br>[7435, 7495, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    90["Segment<br>[7510, 7572, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    91["Segment<br>[7585, 7681, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    92["Segment<br>[7696, 7760, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    93["Segment<br>[7774, 7834, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    94["Segment<br>[7850, 7908, 0]"]
      %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path95 [Path]
    95["Path Region<br>[8974, 9046, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    96["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    97["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    98["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    99["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    100["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    101["Segment<br>[8974, 9046, 0]"]
      %% [ProgramBodyItem { index: 23 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    118["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    119["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    120["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    128["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    129["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    130["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    138["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    139["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    140["Segment<br>[9395, 9476, 0]"]
      %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  end
  1["Plane<br>[602, 1092, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  6["Sweep Extrusion<br>[1169, 1213, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  7[Wall]
    %% face_code_ref=Missing NodePath
  8["Cap Start"]
    %% face_code_ref=Missing NodePath
  9["Cap End"]
    %% face_code_ref=Missing NodePath
  10["SweepEdge Opposite"]
  11["SweepEdge Adjacent"]
  12["Plane<br>[1302, 5925, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31["Sweep Revolve<br>[6028, 6057, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32[Wall]
    %% face_code_ref=Missing NodePath
  33[Wall]
    %% face_code_ref=Missing NodePath
  34[Wall]
    %% face_code_ref=Missing NodePath
  35[Wall]
    %% face_code_ref=Missing NodePath
  36[Wall]
    %% face_code_ref=Missing NodePath
  37[Wall]
    %% face_code_ref=Missing NodePath
  38[Wall]
    %% face_code_ref=Missing NodePath
  39["SweepEdge Adjacent"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Adjacent"]
  45["Sweep Extrusion<br>[6168, 6185, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  48[Wall]
    %% face_code_ref=Missing NodePath
  49["Cap Start"]
    %% face_code_ref=Missing NodePath
  50["Cap End"]
    %% face_code_ref=Missing NodePath
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["Pattern Transform<br>[6191, 6272, 0]<br>Copies: 3<br>Faces: 9<br>Edges: 9"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  54["Sweep Extrusion<br>[6191, 6272, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  56[Wall]
    %% face_code_ref=Missing NodePath
  57["Cap Start"]
    %% face_code_ref=Missing NodePath
  58["Cap End"]
    %% face_code_ref=Missing NodePath
  59["SweepEdge Opposite"]
  60["SweepEdge Adjacent"]
  61["Sweep Extrusion<br>[6191, 6272, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  63[Wall]
    %% face_code_ref=Missing NodePath
  64["Cap Start"]
    %% face_code_ref=Missing NodePath
  65["Cap End"]
    %% face_code_ref=Missing NodePath
  66["SweepEdge Opposite"]
  67["SweepEdge Adjacent"]
  68["Sweep Extrusion<br>[6191, 6272, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  70[Wall]
    %% face_code_ref=Missing NodePath
  71["Cap Start"]
    %% face_code_ref=Missing NodePath
  72["Cap End"]
    %% face_code_ref=Missing NodePath
  73["SweepEdge Opposite"]
  74["SweepEdge Adjacent"]
  75["CompositeSolid Subtract<br>[6280, 6328, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 17 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  76["Plane<br>[6424, 6958, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  81["Sweep Extrusion<br>[7035, 7117, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  82[Wall]
    %% face_code_ref=Missing NodePath
  83["Cap Start"]
    %% face_code_ref=Missing NodePath
  84["Cap End"]
    %% face_code_ref=Missing NodePath
  85["SweepEdge Opposite"]
  86["SweepEdge Adjacent"]
  87["Plane<br>[7195, 8959, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  102["Sweep Revolve<br>[9059, 9088, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  103[Wall]
    %% face_code_ref=Missing NodePath
  104[Wall]
    %% face_code_ref=Missing NodePath
  105[Wall]
    %% face_code_ref=Missing NodePath
  106[Wall]
    %% face_code_ref=Missing NodePath
  107[Wall]
    %% face_code_ref=Missing NodePath
  108["SweepEdge Adjacent"]
  109["SweepEdge Adjacent"]
  110["SweepEdge Adjacent"]
  111["SweepEdge Adjacent"]
  112["CompositeSolid Subtract<br>[9168, 9208, 0]<br>Consumed: true"]
    %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  113["CompositeSolid Subtract<br>[9276, 9321, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  114["Pattern Transform<br>[9395, 9476, 0]<br>Copies: 3<br>Faces: 30<br>Edges: 78"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  115["CompositeSolid Subtract<br>[9395, 9476, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  116[Wall]
    %% face_code_ref=Missing NodePath
  117[Wall]
    %% face_code_ref=Missing NodePath
  121[Wall]
    %% face_code_ref=Missing NodePath
  122[Wall]
    %% face_code_ref=Missing NodePath
  123[Wall]
    %% face_code_ref=Missing NodePath
  124[Wall]
    %% face_code_ref=Missing NodePath
  125["CompositeSolid Subtract<br>[9395, 9476, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  126[Wall]
    %% face_code_ref=Missing NodePath
  127[Wall]
    %% face_code_ref=Missing NodePath
  131[Wall]
    %% face_code_ref=Missing NodePath
  132[Wall]
    %% face_code_ref=Missing NodePath
  133[Wall]
    %% face_code_ref=Missing NodePath
  134[Wall]
    %% face_code_ref=Missing NodePath
  135["CompositeSolid Subtract<br>[9395, 9476, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
  136[Wall]
    %% face_code_ref=Missing NodePath
  137[Wall]
    %% face_code_ref=Missing NodePath
  141[Wall]
    %% face_code_ref=Missing NodePath
  142[Wall]
    %% face_code_ref=Missing NodePath
  143[Wall]
    %% face_code_ref=Missing NodePath
  144[Wall]
    %% face_code_ref=Missing NodePath
  145["SketchBlock<br>[602, 1092, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  146["SketchBlockConstraint Coincident<br>[804, 847, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  147["SketchBlockConstraint Coincident<br>[850, 902, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  148["SketchBlockConstraint Coincident<br>[905, 954, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  149["SketchBlockConstraint Horizontal<br>[958, 985, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  150["SketchBlockConstraint Distance<br>[988, 1090, 0]"]
    %% [ProgramBodyItem { index: 8 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  151["SketchBlock<br>[1302, 5925, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  152["SketchBlockConstraint Coincident<br>[3019, 3061, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 17 }, ExpressionStatementExpr]
  153["SketchBlockConstraint Coincident<br>[3064, 3103, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 18 }, ExpressionStatementExpr]
  154["SketchBlockConstraint Coincident<br>[3106, 3179, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 19 }, ExpressionStatementExpr]
  155["SketchBlockConstraint Coincident<br>[3182, 3230, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 20 }, ExpressionStatementExpr]
  156["SketchBlockConstraint Coincident<br>[3233, 3277, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 21 }, ExpressionStatementExpr]
  157["SketchBlockConstraint Coincident<br>[3280, 3331, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 22 }, ExpressionStatementExpr]
  158["SketchBlockConstraint Coincident<br>[3334, 3382, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 23 }, ExpressionStatementExpr]
  159["SketchBlockConstraint Coincident<br>[3385, 3456, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 24 }, ExpressionStatementExpr]
  160["SketchBlockConstraint Coincident<br>[3459, 3527, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 25 }, ExpressionStatementExpr]
  161["SketchBlockConstraint Coincident<br>[3530, 3602, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 26 }, ExpressionStatementExpr]
  162["SketchBlockConstraint Coincident<br>[3605, 3672, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 27 }, ExpressionStatementExpr]
  163["SketchBlockConstraint Coincident<br>[3675, 3746, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 28 }, ExpressionStatementExpr]
  164["SketchBlockConstraint Coincident<br>[3749, 3817, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 29 }, ExpressionStatementExpr]
  165["SketchBlockConstraint Coincident<br>[3820, 3892, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 30 }, ExpressionStatementExpr]
  166["SketchBlockConstraint Coincident<br>[3895, 3962, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 31 }, ExpressionStatementExpr]
  167["SketchBlockConstraint Coincident<br>[3966, 4034, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 32 }, ExpressionStatementExpr]
  168["SketchBlockConstraint Coincident<br>[4037, 4085, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 33 }, ExpressionStatementExpr]
  169["SketchBlockConstraint Coincident<br>[4088, 4134, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 34 }, ExpressionStatementExpr]
  170["SketchBlockConstraint Coincident<br>[4137, 4182, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 35 }, ExpressionStatementExpr]
  171["SketchBlockConstraint Coincident<br>[4185, 4234, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 36 }, ExpressionStatementExpr]
  172["SketchBlockConstraint Coincident<br>[4237, 4281, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 37 }, ExpressionStatementExpr]
  173["SketchBlockConstraint Coincident<br>[4284, 4326, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 38 }, ExpressionStatementExpr]
  174["SketchBlockConstraint Coincident<br>[4329, 4380, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 39 }, ExpressionStatementExpr]
  175["SketchBlockConstraint Coincident<br>[4383, 4430, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 40 }, ExpressionStatementExpr]
  176["SketchBlockConstraint Coincident<br>[4433, 4482, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 41 }, ExpressionStatementExpr]
  177["SketchBlockConstraint Coincident<br>[4485, 4534, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 42 }, ExpressionStatementExpr]
  178["SketchBlockConstraint Horizontal<br>[4538, 4564, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 43 }, ExpressionStatementExpr]
  179["SketchBlockConstraint Horizontal<br>[4567, 4590, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 44 }, ExpressionStatementExpr]
  180["SketchBlockConstraint Vertical<br>[4593, 4624, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 45 }, ExpressionStatementExpr]
  181["SketchBlockConstraint Vertical<br>[4627, 4646, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 46 }, ExpressionStatementExpr]
  182["SketchBlockConstraint Horizontal<br>[4649, 4674, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 47 }, ExpressionStatementExpr]
  183["SketchBlockConstraint Horizontal<br>[4677, 4704, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 48 }, ExpressionStatementExpr]
  184["SketchBlockConstraint Vertical<br>[4707, 4736, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 49 }, ExpressionStatementExpr]
  185["SketchBlockConstraint Horizontal<br>[4739, 4771, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 50 }, ExpressionStatementExpr]
  186["SketchBlockConstraint Vertical<br>[4774, 4803, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 51 }, ExpressionStatementExpr]
  187["SketchBlockConstraint Horizontal<br>[4806, 4838, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 52 }, ExpressionStatementExpr]
  188["SketchBlockConstraint Horizontal<br>[4841, 4866, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 53 }, ExpressionStatementExpr]
  189["SketchBlockConstraint Horizontal<br>[4869, 4893, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 54 }, ExpressionStatementExpr]
  190["SketchBlockConstraint Horizontal<br>[4896, 4915, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 55 }, ExpressionStatementExpr]
  191["SketchBlockConstraint Horizontal<br>[4918, 4942, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 56 }, ExpressionStatementExpr]
  192["SketchBlockConstraint Distance<br>[4946, 5024, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 57 }, ExpressionStatementExpr]
  193["SketchBlockConstraint Distance<br>[5027, 5100, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 58 }, ExpressionStatementExpr]
  194["SketchBlockConstraint Distance<br>[5103, 5217, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 59 }, ExpressionStatementExpr]
  195["SketchBlockConstraint Distance<br>[5220, 5279, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 60 }, ExpressionStatementExpr]
  196["SketchBlockConstraint Distance<br>[5282, 5345, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 61 }, ExpressionStatementExpr]
  197["SketchBlockConstraint Distance<br>[5348, 5416, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 62 }, ExpressionStatementExpr]
  198["SketchBlockConstraint Distance<br>[5419, 5499, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 63 }, ExpressionStatementExpr]
  199["SketchBlockConstraint Distance<br>[5502, 5596, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 64 }, ExpressionStatementExpr]
  200["SketchBlockConstraint Distance<br>[5599, 5695, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 65 }, ExpressionStatementExpr]
  201["SketchBlockConstraint Distance<br>[5698, 5808, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 66 }, ExpressionStatementExpr]
  202["SketchBlockConstraint Distance<br>[5811, 5923, 0]"]
    %% [ProgramBodyItem { index: 12 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 67 }, ExpressionStatementExpr]
  203["SketchBlock<br>[6424, 6958, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  204["SketchBlockConstraint Coincident<br>[6634, 6680, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  205["SketchBlockConstraint Coincident<br>[6683, 6755, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  206["SketchBlockConstraint Coincident<br>[6758, 6827, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  207["SketchBlockConstraint Horizontal<br>[6831, 6861, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  208["SketchBlockConstraint Distance<br>[6864, 6956, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  209["SketchBlock<br>[7195, 8959, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  210["SketchBlockConstraint Coincident<br>[7912, 7950, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  211["SketchBlockConstraint Coincident<br>[7953, 7997, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  212["SketchBlockConstraint Coincident<br>[8000, 8042, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  213["SketchBlockConstraint Coincident<br>[8045, 8086, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  214["SketchBlockConstraint Coincident<br>[8089, 8129, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 12 }, ExpressionStatementExpr]
  215["SketchBlockConstraint Coincident<br>[8132, 8176, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 13 }, ExpressionStatementExpr]
  216["SketchBlockConstraint Coincident<br>[8179, 8222, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 14 }, ExpressionStatementExpr]
  217["SketchBlockConstraint Coincident<br>[8226, 8274, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 15 }, ExpressionStatementExpr]
  218["SketchBlockConstraint Coincident<br>[8277, 8321, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 16 }, ExpressionStatementExpr]
  219["SketchBlockConstraint Coincident<br>[8324, 8375, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 17 }, ExpressionStatementExpr]
  220["SketchBlockConstraint Coincident<br>[8378, 8424, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 18 }, ExpressionStatementExpr]
  221["SketchBlockConstraint Horizontal<br>[8428, 8446, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 19 }, ExpressionStatementExpr]
  222["SketchBlockConstraint Vertical<br>[8449, 8468, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 20 }, ExpressionStatementExpr]
  223["SketchBlockConstraint Vertical<br>[8471, 8490, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 21 }, ExpressionStatementExpr]
  224["SketchBlockConstraint Horizontal<br>[8493, 8513, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 22 }, ExpressionStatementExpr]
  225["SketchBlockConstraint Vertical<br>[8516, 8536, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 23 }, ExpressionStatementExpr]
  226["SketchBlockConstraint Vertical<br>[8539, 8562, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 24 }, ExpressionStatementExpr]
  227["SketchBlockConstraint Vertical<br>[8565, 8590, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 25 }, ExpressionStatementExpr]
  228["SketchBlockConstraint Distance<br>[8594, 8652, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 26 }, ExpressionStatementExpr]
  229["SketchBlockConstraint Distance<br>[8655, 8711, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 27 }, ExpressionStatementExpr]
  230["SketchBlockConstraint LinesEqualLength<br>[8714, 8745, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 28 }, ExpressionStatementExpr]
  231["SketchBlockConstraint Distance<br>[8748, 8803, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 29 }, ExpressionStatementExpr]
  232["SketchBlockConstraint Distance<br>[8806, 8874, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 30 }, ExpressionStatementExpr]
  233["SketchBlockConstraint Distance<br>[8877, 8957, 0]"]
    %% [ProgramBodyItem { index: 22 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 31 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 4
  1 <--x 46
  1 <--x 145
  2 --- 3
  2 <--x 4
  2 <--x 46
  145 --- 2
  3 <--x 5
  3 <--x 47
  3 <--x 55
  3 <--x 62
  3 <--x 69
  4 --- 5
  4 ---- 6
  4 --- 113
  4 <--x 115
  4 <--x 125
  4 <--x 135
  5 --- 7
  5 x--> 8
  5 --- 10
  5 --- 11
  5 <--x 116
  5 <--x 126
  5 <--x 136
  6 --- 7
  6 --- 8
  6 --- 9
  6 --- 10
  6 --- 11
  6 <--x 116
  6 <--x 126
  6 <--x 136
  7 --- 10
  7 --- 11
  10 <--x 9
  116 <--x 10
  126 <--x 10
  136 <--x 10
  116 <--x 11
  126 <--x 11
  136 <--x 11
  12 --- 13
  12 <--x 22
  12 <--x 151
  13 --- 14
  13 --- 15
  13 --- 16
  13 --- 17
  13 --- 18
  13 --- 19
  13 --- 20
  13 --- 21
  13 <--x 22
  151 --- 13
  14 <--x 23
  15 <--x 24
  16 <--x 25
  17 <--x 26
  18 <--x 27
  19 <--x 28
  20 <--x 29
  21 <--x 30
  22 --- 23
  22 --- 24
  22 --- 25
  22 --- 26
  22 --- 27
  22 --- 28
  22 --- 29
  22 --- 30
  22 ---- 31
  22 --- 75
  31 <--x 24
  24 --- 37
  24 --- 43
  31 <--x 25
  25 --- 36
  25 --- 42
  31 <--x 26
  26 --- 35
  26 --- 41
  31 <--x 27
  27 --- 32
  27 --- 39
  31 <--x 28
  28 --- 33
  28 --- 40
  31 <--x 29
  29 --- 38
  29 --- 44
  31 <--x 30
  30 --- 34
  31 --- 32
  31 --- 33
  31 --- 34
  31 --- 35
  31 --- 36
  31 --- 37
  31 --- 38
  31 --- 39
  31 --- 40
  31 --- 41
  31 --- 42
  31 --- 43
  31 --- 44
  32 --- 39
  43 <--x 32
  39 <--x 33
  33 --- 40
  40 <--x 34
  35 x--> 41
  41 <--x 36
  36 x--> 42
  41 <--x 37
  42 <--x 37
  37 x--> 43
  42 <--x 38
  43 <--x 38
  38 x--> 44
  46 ---- 45
  45 --- 48
  45 --- 49
  45 --- 50
  45 --- 51
  45 --- 52
  45 x--> 53
  46 --- 47
  46 --- 53
  46 <---x 54
  46 <--x 55
  46 <---x 61
  46 <--x 62
  46 <---x 68
  46 <--x 69
  46 --- 75
  47 --- 48
  47 x--> 49
  47 --- 51
  47 --- 52
  48 --- 51
  48 --- 52
  51 <--x 50
  53 x--> 54
  53 x--> 55
  53 x--> 56
  53 x--> 57
  53 x--> 58
  53 x--> 59
  53 x--> 60
  53 x--> 61
  53 x--> 62
  53 x--> 63
  53 x--> 64
  53 x--> 65
  53 x--> 66
  53 x--> 67
  53 x--> 68
  53 x--> 69
  53 x--> 70
  53 x--> 71
  53 x--> 72
  53 x--> 73
  53 x--> 74
  54 --- 56
  54 --- 57
  54 --- 58
  54 --- 59
  54 --- 60
  54 <--x 75
  55 --- 56
  55 x--> 57
  55 --- 59
  55 --- 60
  56 --- 59
  56 --- 60
  59 <--x 58
  61 --- 63
  61 --- 64
  61 --- 65
  61 --- 66
  61 --- 67
  61 <--x 75
  62 --- 63
  62 x--> 64
  62 --- 66
  62 --- 67
  63 --- 66
  63 --- 67
  66 <--x 65
  68 --- 70
  68 --- 71
  68 --- 72
  68 --- 73
  68 --- 74
  68 <--x 75
  69 --- 70
  69 x--> 71
  69 --- 73
  69 --- 74
  70 --- 73
  70 --- 74
  73 <--x 72
  76 --- 77
  76 <--x 79
  76 <--x 203
  77 --- 78
  77 <--x 79
  203 --- 77
  78 <--x 80
  79 --- 80
  79 ---- 81
  79 --- 112
  80 --- 82
  80 x--> 84
  80 --- 85
  80 --- 86
  80 <--x 117
  80 <--x 127
  80 <--x 137
  81 --- 82
  81 --- 83
  81 --- 84
  81 --- 85
  81 --- 86
  81 <--x 117
  81 <--x 127
  81 <--x 137
  82 --- 85
  82 --- 86
  85 <--x 83
  117 <--x 85
  127 <--x 85
  137 <--x 85
  117 <--x 86
  127 <--x 86
  137 <--x 86
  87 --- 88
  87 <--x 95
  87 <--x 209
  88 --- 89
  88 --- 90
  88 --- 91
  88 --- 92
  88 --- 93
  88 --- 94
  88 <--x 95
  209 --- 88
  89 <--x 96
  90 <--x 97
  90 <--x 118
  90 <--x 128
  90 <--x 138
  91 <--x 98
  91 <--x 119
  91 <--x 129
  91 <--x 139
  92 <--x 99
  92 <--x 120
  92 <--x 130
  92 <--x 140
  93 <--x 100
  94 <--x 101
  95 --- 96
  95 --- 97
  95 --- 98
  95 --- 99
  95 --- 100
  95 --- 101
  95 ---- 102
  95 --- 112
  95 <--x 118
  95 <--x 119
  95 <--x 120
  95 <--x 128
  95 <--x 129
  95 <--x 130
  95 <--x 138
  95 <--x 139
  95 <--x 140
  102 <--x 97
  97 --- 104
  97 --- 109
  102 <--x 98
  98 --- 105
  98 --- 110
  102 <--x 99
  99 --- 106
  99 --- 111
  102 <--x 100
  100 --- 103
  100 --- 108
  100 <--x 121
  100 <--x 131
  100 <--x 141
  102 <--x 101
  101 --- 107
  102 --- 103
  102 --- 104
  102 --- 105
  102 --- 106
  102 --- 107
  102 --- 108
  102 --- 109
  102 --- 110
  102 --- 111
  102 <--x 121
  102 <--x 122
  102 <--x 123
  102 <--x 124
  102 <--x 131
  102 <--x 132
  102 <--x 133
  102 <--x 134
  102 <--x 141
  102 <--x 142
  102 <--x 143
  102 <--x 144
  103 --- 108
  108 <--x 104
  104 --- 109
  109 <--x 105
  105 --- 110
  110 <--x 106
  106 --- 111
  111 <--x 107
  121 <--x 108
  131 <--x 108
  141 <--x 108
  118 <--x 109
  122 <--x 109
  128 <--x 109
  132 <--x 109
  138 <--x 109
  142 <--x 109
  119 <--x 110
  123 <--x 110
  129 <--x 110
  133 <--x 110
  139 <--x 110
  143 <--x 110
  120 <--x 111
  124 <--x 111
  130 <--x 111
  134 <--x 111
  140 <--x 111
  144 <--x 111
  112 --- 113
  112 <--x 115
  112 <--x 125
  112 <--x 135
  113 --- 114
  114 x--> 115
  114 x--> 116
  114 x--> 117
  114 x--> 118
  114 x--> 119
  114 x--> 120
  114 x--> 121
  114 x--> 122
  114 x--> 123
  114 x--> 124
  114 x--> 125
  114 x--> 126
  114 x--> 127
  114 x--> 128
  114 x--> 129
  114 x--> 130
  114 x--> 131
  114 x--> 132
  114 x--> 133
  114 x--> 134
  114 x--> 135
  114 x--> 136
  114 x--> 137
  114 x--> 138
  114 x--> 139
  114 x--> 140
  114 x--> 141
  114 x--> 142
  114 x--> 143
  114 x--> 144
  118 --- 122
  119 --- 123
  120 --- 124
  128 --- 132
  129 --- 133
  130 --- 134
  138 --- 142
  139 --- 143
  140 --- 144
```

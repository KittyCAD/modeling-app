```mermaid
flowchart LR
  subgraph path1 [Path]
    1["Path<br>[0, 23, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 0 }]
    5["Segment<br>[0, 23, 0]"]
      %% [ProgramBodyItem { index: 0 }]
    6["Segment<br>[0, 23, 0]"]
      %% [ProgramBodyItem { index: 0 }]
    7["Segment<br>[0, 23, 0]"]
      %% [ProgramBodyItem { index: 0 }]
    8["Segment<br>[0, 23, 0]"]
      %% [ProgramBodyItem { index: 0 }]
  end
  subgraph path2 [Path]
    2["Path<br>[24, 47, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 1 }]
    9["Segment<br>[24, 47, 0]"]
      %% [ProgramBodyItem { index: 1 }]
    10["Segment<br>[24, 47, 0]"]
      %% [ProgramBodyItem { index: 1 }]
    11["Segment<br>[24, 47, 0]"]
      %% [ProgramBodyItem { index: 1 }]
    12["Segment<br>[24, 47, 0]"]
      %% [ProgramBodyItem { index: 1 }]
  end
  3["Plane<br>[0, 23, 0]"]
    %% [ProgramBodyItem { index: 0 }]
  4["Plane<br>[24, 47, 0]"]
    %% [ProgramBodyItem { index: 1 }]
  13["SketchBlock<br>[0, 23, 0]"]
    %% [ProgramBodyItem { index: 0 }]
  15["SketchBlockConstraint Coincident<br>[356, 392, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  16["SketchBlockConstraint Coincident<br>[395, 431, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  17["SketchBlockConstraint Coincident<br>[434, 470, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  18["SketchBlockConstraint Coincident<br>[473, 509, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  25["SketchBlockConstraint Parallel<br>[512, 536, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  26["SketchBlockConstraint Parallel<br>[539, 563, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  29["SketchBlockConstraint Perpendicular<br>[566, 595, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  23["SketchBlockConstraint Horizontal<br>[598, 615, 1]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  14["SketchBlock<br>[24, 47, 0]"]
    %% [ProgramBodyItem { index: 1 }]
  19["SketchBlockConstraint Coincident<br>[356, 392, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  20["SketchBlockConstraint Coincident<br>[395, 431, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  21["SketchBlockConstraint Coincident<br>[434, 470, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  22["SketchBlockConstraint Coincident<br>[473, 509, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  27["SketchBlockConstraint Parallel<br>[512, 536, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  28["SketchBlockConstraint Parallel<br>[539, 563, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 9 }, ExpressionStatementExpr]
  30["SketchBlockConstraint Perpendicular<br>[566, 595, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 10 }, ExpressionStatementExpr]
  24["SketchBlockConstraint Horizontal<br>[598, 615, 2]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 11 }, ExpressionStatementExpr]
  3 --- 1
  1 --- 5
  1 --- 6
  1 --- 7
  1 --- 8
  13 --- 1
  4 --- 2
  2 --- 9
  2 --- 10
  2 --- 11
  2 --- 12
  14 --- 2
  3 <--x 13
  4 <--x 14
```

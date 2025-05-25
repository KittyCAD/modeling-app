```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[52, 89, 0]"]
      %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 1 }]
    5["Segment<br>[95, 119, 0]"]
      %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 2 }]
    6["Segment<br>[125, 215, 0]"]
      %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 3 }]
    7["Segment<br>[221, 228, 0]"]
      %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 4 }]
    12[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[275, 300, 0]"]
      %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 1 }]
    8["Segment<br>[306, 330, 0]"]
      %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 2 }]
    9["Segment<br>[336, 427, 0]"]
      %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 3 }]
    10["Segment<br>[436, 443, 0]"]
      %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 4 }]
    11[Solid2d]
  end
  1["Plane<br>[31, 48, 0]"]
    %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 0 }]
  2["Plane<br>[254, 271, 0]"]
    %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 0 }]
  13["Sweep Revolve<br>[234, 251, 0]"]
    %% [ProgramBodyItem { index: 2 }, ExpressionStatementExpr, PipeBodyItem { index: 5 }]
  14["Sweep Revolve<br>[452, 469, 0]"]
    %% [ProgramBodyItem { index: 3 }, ExpressionStatementExpr, PipeBodyItem { index: 5 }]
  15[Wall]
    %% face_code_ref=Missing NodePath
  16[Wall]
    %% face_code_ref=Missing NodePath
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 12
  3 ---- 13
  4 --- 8
  4 --- 9
  4 --- 10
  4 --- 11
  4 ---- 14
  13 <--x 6
  6 --- 15
  14 <--x 9
  9 --- 16
  13 --- 15
  14 --- 16
```

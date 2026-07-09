```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[43, 81, 2]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, PipeBodyItem { index: 1 }]
    4["Segment<br>[43, 81, 2]"]
      %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, PipeBodyItem { index: 1 }]
    6[Solid2d]
  end
  1[Wall]
    %% face_code_ref=Missing NodePath
  2["Plane<br>[18, 35, 2]"]
    %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, PipeBodyItem { index: 0 }]
  5["Sweep Revolve<br>[89, 142, 2]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, PipeBodyItem { index: 2 }]
  7["SweepEdge Adjacent"]
  4 --- 1
  5 --- 1
  1 --- 7
  2 --- 3
  3 --- 4
  3 ---- 5
  3 --- 6
  5 <--x 4
  4 --- 7
  5 --- 7
```

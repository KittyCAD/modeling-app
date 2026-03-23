```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[41, 271, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
    3["Segment<br>[66, 152, 0]"]
      %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
    4["Segment<br>[160, 249, 0]"]
      %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
  end
  1["Plane<br>[41, 271, 0]"]
    %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
  5["SketchBlock<br>[41, 271, 0]"]
    %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
  6["SketchBlockConstraint Tangent<br>[252, 269, 0]"]
    %% [ProgramBodyItem { index: 0 }, ExpressionStatementExpr, SketchBlock]
  1 --- 2
  1 <--x 5
  2 --- 3
  2 --- 4
```

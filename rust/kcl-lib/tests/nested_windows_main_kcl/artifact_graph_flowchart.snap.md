```mermaid
flowchart LR
  subgraph path1 [Path]
    1["Path<br>[0, 32, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }]
    3["Segment<br>[0, 32, 0]"]
      %% [ProgramBodyItem { index: 0 }]
    4[Solid2d]
  end
  2["Plane<br>[0, 32, 0]"]
    %% [ProgramBodyItem { index: 0 }]
  5["Sweep Revolve<br>[0, 32, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }]
  6["SweepEdge Adjacent"]
  7[Wall]
    %% face_code_ref=Missing NodePath
  2 --- 1
  1 --- 3
  1 --- 4
  1 ---- 5
  5 <--x 3
  3 --- 6
  3 --- 7
  5 --- 6
  5 --- 7
  7 --- 6
```

```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[195, 230, 1]"]
      %% Missing NodePath
    5["Segment<br>[195, 230, 1]"]
      %% Missing NodePath
    8[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[111, 146, 3]"]
      %% Missing NodePath
    6["Segment<br>[111, 146, 3]"]
      %% Missing NodePath
    7[Solid2d]
  end
  1["Plane<br>[172, 189, 1]"]
    %% Missing NodePath
  2["Plane<br>[88, 105, 3]"]
    %% Missing NodePath
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 8
  4 --- 6
  4 --- 7
```

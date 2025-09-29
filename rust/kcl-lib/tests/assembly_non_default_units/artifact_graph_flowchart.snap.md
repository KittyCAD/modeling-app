```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[195, 230, 1]"]
    3["Segment<br>[195, 230, 1]"]
    4[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[111, 146, 3]"]
    7["Segment<br>[111, 146, 3]"]
    8[Solid2d]
  end
  1["Plane<br>[172, 189, 1]"]
  5["Plane<br>[88, 105, 3]"]
  1 --- 2
  2 --- 3
  2 --- 4
  5 --- 6
  6 --- 7
  6 --- 8
```

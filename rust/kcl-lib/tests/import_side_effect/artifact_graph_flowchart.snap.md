```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[102, 138, 5]"]
    3["Segment<br>[102, 138, 5]"]
    4[Solid2d]
  end
  1["Plane<br>[77, 96, 5]"]
  1 --- 2
  2 --- 3
  2 --- 4
```

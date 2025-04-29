```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[102, 138, 8]"]
    3["Segment<br>[102, 138, 8]"]
    4[Solid2d]
  end
  1["Plane<br>[77, 96, 8]"]
  1 --- 2
  2 --- 3
  2 --- 4
```

```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[100, 136, 1]"]
    3["Segment<br>[100, 136, 1]"]
    4[Solid2d]
  end
  1["Plane<br>[77, 94, 1]"]
  1 --- 2
  2 --- 3
  2 --- 4
```

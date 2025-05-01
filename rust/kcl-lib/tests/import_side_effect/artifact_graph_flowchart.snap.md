```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[100, 136, 8]"]
    3["Segment<br>[100, 136, 8]"]
    4[Solid2d]
  end
  1["Plane<br>[77, 94, 8]"]
  1 --- 2
  2 --- 3
  2 --- 4
```

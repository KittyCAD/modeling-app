```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[106, 149, 1]"]
    3["Segment<br>[106, 149, 1]"]
    4[Solid2d]
  end
  1["Plane<br>[81, 100, 1]"]
  1 --- 2
  2 --- 3
  2 --- 4
```

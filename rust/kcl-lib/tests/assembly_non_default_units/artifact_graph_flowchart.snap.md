```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[197, 232, 6]"]
    3["Segment<br>[197, 232, 6]"]
    4[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[113, 148, 7]"]
    7["Segment<br>[113, 148, 7]"]
    8[Solid2d]
  end
  1["Plane<br>[172, 191, 6]"]
  5["Plane<br>[88, 107, 7]"]
  1 --- 2
  2 --- 3
  2 --- 4
  5 --- 6
  6 --- 7
  6 --- 8
```

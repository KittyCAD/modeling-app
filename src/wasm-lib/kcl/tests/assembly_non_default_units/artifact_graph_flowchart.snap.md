```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[197, 239, 1]"]
    3["Segment<br>[197, 239, 1]"]
    4[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[114, 156, 2]"]
    7["Segment<br>[114, 156, 2]"]
    8[Solid2d]
  end
  1["Plane<br>[172, 191, 1]"]
  5["Plane<br>[89, 108, 2]"]
  1 --- 2
  2 --- 3
  2 --- 4
  5 --- 6
  6 --- 7
  6 --- 8
```

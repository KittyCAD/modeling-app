```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[87, 122, 0]"]
    3["Segment<br>[128, 176, 0]"]
    4["Segment<br>[182, 241, 0]"]
    5["Segment<br>[247, 312, 0]"]
    6["Segment<br>[318, 384, 0]"]
    7["Segment<br>[390, 412, 0]"]
  end
  1["Plane<br>[64, 81, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
```

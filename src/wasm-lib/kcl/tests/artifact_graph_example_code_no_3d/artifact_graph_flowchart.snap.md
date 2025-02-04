```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[37, 65, 0]"]
    3["Segment<br>[71, 121, 0]"]
    4["Segment<br>[127, 227, 0]"]
    5["Segment<br>[233, 353, 0]"]
    6["Segment<br>[359, 394, 0]"]
    7["Segment<br>[400, 407, 0]"]
    8[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[446, 475, 0]"]
    11["Segment<br>[481, 506, 0]"]
    12["Segment<br>[512, 538, 0]"]
    13["Segment<br>[544, 576, 0]"]
  end
  1["Plane<br>[12, 31, 0]"]
  9["Plane<br>[420, 440, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  9 --- 10
  10 --- 11
  10 --- 12
  10 --- 13
```

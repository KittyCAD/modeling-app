```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[37, 65, 0]"]
    3["Segment<br>[71, 139, 0]"]
    4["Segment<br>[145, 242, 0]"]
    5["Segment<br>[248, 365, 0]"]
    6["Segment<br>[371, 427, 0]"]
    7["Segment<br>[433, 440, 0]"]
    8[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[479, 508, 0]"]
    11["Segment<br>[514, 539, 0]"]
    12["Segment<br>[545, 571, 0]"]
    13["Segment<br>[577, 609, 0]"]
  end
  1["Plane<br>[12, 31, 0]"]
  9["Plane<br>[453, 473, 0]"]
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

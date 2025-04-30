```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[37, 65, 0]"]
    5["Segment<br>[71, 139, 0]"]
    6["Segment<br>[145, 242, 0]"]
    7["Segment<br>[248, 365, 0]"]
    8["Segment<br>[371, 427, 0]"]
    9["Segment<br>[433, 440, 0]"]
    13[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[479, 508, 0]"]
    10["Segment<br>[514, 539, 0]"]
    11["Segment<br>[545, 580, 0]"]
    12["Segment<br>[586, 627, 0]"]
  end
  1["Plane<br>[12, 31, 0]"]
  2["Plane<br>[453, 473, 0]"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 13
  4 --- 10
  4 --- 11
  4 --- 12
```

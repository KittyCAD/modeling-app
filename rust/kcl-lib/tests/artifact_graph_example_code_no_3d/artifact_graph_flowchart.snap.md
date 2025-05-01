```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[35, 63, 0]"]
    5["Segment<br>[69, 137, 0]"]
    6["Segment<br>[143, 240, 0]"]
    7["Segment<br>[246, 363, 0]"]
    8["Segment<br>[369, 425, 0]"]
    9["Segment<br>[431, 438, 0]"]
    13[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[475, 504, 0]"]
    10["Segment<br>[510, 535, 0]"]
    11["Segment<br>[541, 576, 0]"]
    12["Segment<br>[582, 623, 0]"]
  end
  1["Plane<br>[12, 29, 0]"]
  2["Plane<br>[451, 469, 0]"]
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

```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[89, 124, 0]"]
    3["Segment<br>[130, 178, 0]"]
    4["Segment<br>[184, 243, 0]"]
    5["Segment<br>[249, 314, 0]"]
    6["Segment<br>[320, 386, 0]"]
    7["Segment<br>[392, 414, 0]"]
  end
  1["Plane<br>[64, 83, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
```

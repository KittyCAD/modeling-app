```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[35, 60, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    9["Segment<br>[66, 84, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    10["Segment<br>[90, 123, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    11["Segment<br>[129, 185, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    12["Segment<br>[191, 198, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    27[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[300, 330, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    13["Segment<br>[336, 354, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    14["Segment<br>[360, 379, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    15["Segment<br>[385, 441, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    16["Segment<br>[447, 454, 0]"]
      %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    25[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[556, 583, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    17["Segment<br>[589, 623, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    18["Segment<br>[629, 648, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    19["Segment<br>[654, 710, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    20["Segment<br>[716, 723, 0]"]
      %% [ProgramBodyItem { index: 4 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    28[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[825, 852, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    21["Segment<br>[858, 878, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    22["Segment<br>[884, 905, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    23["Segment<br>[911, 967, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    24["Segment<br>[973, 980, 0]"]
      %% [ProgramBodyItem { index: 6 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    26[Solid2d]
  end
  1["Plane<br>[12, 29, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  2["StartSketchOnFace<br>[255, 294, 0]"]
    %% Missing NodePath
  3["StartSketchOnFace<br>[780, 819, 0]"]
    %% Missing NodePath
  4["StartSketchOnFace<br>[511, 550, 0]"]
    %% Missing NodePath
  29["Sweep Extrusion<br>[212, 242, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  30["Sweep Extrusion<br>[468, 498, 0]"]
    %% [ProgramBodyItem { index: 3 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31["Sweep Extrusion<br>[737, 767, 0]"]
    %% [ProgramBodyItem { index: 5 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32["Sweep Extrusion<br>[994, 1024, 0]"]
    %% [ProgramBodyItem { index: 7 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  33[Wall]
  34[Wall]
  35[Wall]
  36[Wall]
  37[Wall]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43[Wall]
  44[Wall]
  45["Cap Start"]
  46["Cap End"]
  47["Cap End"]
  48["Cap End"]
  49["Cap End"]
  50["SweepEdge Opposite"]
  51["SweepEdge Opposite"]
  52["SweepEdge Opposite"]
  53["SweepEdge Opposite"]
  54["SweepEdge Opposite"]
  55["SweepEdge Opposite"]
  56["SweepEdge Opposite"]
  57["SweepEdge Opposite"]
  58["SweepEdge Opposite"]
  59["SweepEdge Opposite"]
  60["SweepEdge Opposite"]
  61["SweepEdge Opposite"]
  62["SweepEdge Adjacent"]
  63["SweepEdge Adjacent"]
  64["SweepEdge Adjacent"]
  65["SweepEdge Adjacent"]
  66["SweepEdge Adjacent"]
  67["SweepEdge Adjacent"]
  68["SweepEdge Adjacent"]
  69["SweepEdge Adjacent"]
  70["SweepEdge Adjacent"]
  71["SweepEdge Adjacent"]
  72["SweepEdge Adjacent"]
  73["SweepEdge Adjacent"]
  1 --- 5
  41 x--> 2
  44 x--> 3
  47 x--> 4
  5 --- 9
  5 --- 10
  5 --- 11
  5 --- 12
  5 --- 27
  5 ---- 29
  6 --- 13
  6 --- 14
  6 --- 15
  6 --- 16
  6 --- 25
  6 ---- 30
  41 --- 6
  7 --- 17
  7 --- 18
  7 --- 19
  7 --- 20
  7 --- 28
  7 ---- 31
  47 --- 7
  8 --- 21
  8 --- 22
  8 --- 23
  8 --- 24
  8 --- 26
  8 ---- 32
  44 --- 8
  9 --- 40
  9 x--> 45
  9 --- 58
  9 --- 69
  10 --- 41
  10 x--> 45
  10 --- 56
  10 --- 70
  11 --- 39
  11 x--> 45
  11 --- 57
  11 --- 68
  13 --- 38
  13 x--> 41
  13 --- 53
  13 --- 66
  14 --- 37
  14 x--> 41
  14 --- 54
  14 --- 65
  15 --- 36
  15 x--> 41
  15 --- 55
  15 --- 67
  17 --- 44
  17 x--> 47
  17 --- 60
  17 --- 72
  18 --- 42
  18 x--> 47
  18 --- 61
  18 --- 71
  19 --- 43
  19 x--> 47
  19 --- 59
  19 --- 73
  21 --- 33
  21 x--> 44
  21 --- 51
  21 --- 64
  22 --- 35
  22 x--> 44
  22 --- 50
  22 --- 62
  23 --- 34
  23 x--> 44
  23 --- 52
  23 --- 63
  29 --- 39
  29 --- 40
  29 --- 41
  29 --- 45
  29 --- 49
  29 --- 56
  29 --- 57
  29 --- 58
  29 --- 68
  29 --- 69
  29 --- 70
  30 --- 36
  30 --- 37
  30 --- 38
  30 --- 47
  30 --- 53
  30 --- 54
  30 --- 55
  30 --- 65
  30 --- 66
  30 --- 67
  31 --- 42
  31 --- 43
  31 --- 44
  31 --- 46
  31 --- 59
  31 --- 60
  31 --- 61
  31 --- 71
  31 --- 72
  31 --- 73
  32 --- 33
  32 --- 34
  32 --- 35
  32 --- 48
  32 --- 50
  32 --- 51
  32 --- 52
  32 --- 62
  32 --- 63
  32 --- 64
  51 <--x 33
  63 <--x 33
  64 <--x 33
  52 <--x 34
  62 <--x 34
  63 <--x 34
  50 <--x 35
  62 <--x 35
  64 <--x 35
  55 <--x 36
  65 <--x 36
  67 <--x 36
  54 <--x 37
  65 <--x 37
  66 <--x 37
  53 <--x 38
  66 <--x 38
  67 <--x 38
  57 <--x 39
  68 <--x 39
  70 <--x 39
  58 <--x 40
  68 <--x 40
  69 <--x 40
  56 <--x 41
  69 <--x 41
  70 <--x 41
  61 <--x 42
  71 <--x 42
  72 <--x 42
  59 <--x 43
  71 <--x 43
  73 <--x 43
  60 <--x 44
  72 <--x 44
  73 <--x 44
  59 <--x 46
  60 <--x 46
  61 <--x 46
  53 <--x 47
  54 <--x 47
  55 <--x 47
  50 <--x 48
  51 <--x 48
  52 <--x 48
  56 <--x 49
  57 <--x 49
  58 <--x 49
```

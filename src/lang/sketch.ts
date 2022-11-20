import { ProgramMemory } from "./executor";

export type Path =
  | {
      type: "points";
      name?: string;
      from: [number, number];
      to: [number, number];
    }
  | {
      type: "horizontalLineTo";
      name?: string;
      x: number;
      previousPath: Path;
    }
  | {
      type: "verticalLineTo";
      name?: string;
      y: number;
      previousPath: Path;
    }
  | {
      type: "toPoint";
      name?: string;
      to: [number, number];
      previousPath: Path;
    }
  | {
      type: "close";
      name?: string;
      firstPath: Path;
      previousPath: Path;
    }
  | {
      type: "base";
      from: [number, number];
    };

function addBasePath(programMemory: ProgramMemory) {
  const base: Path = {
    type: "base",
    from: [0, 0],
  };
  if (programMemory._sketch?.length === 0) {
    return {
      ...programMemory,
      _sketch: [base],
    };
  }
  return programMemory;
}

interface PathReturn {
  programMemory: ProgramMemory;
  currentPath: Path;
}

export const sketchFns = {
  close: (programMemory: ProgramMemory, name: string = ""): PathReturn => {
    const lastPath = programMemory?._sketch?.[
      programMemory?._sketch.length - 1
    ] as Path;
    const firstPath = programMemory?._sketch?.[0] as Path;
    if (lastPath?.type === "base") {
      throw new Error("Cannot close a base path");
    }
    const newPath: Path = {
      type: "close",
      firstPath,
      previousPath: lastPath,
    };
    if (name) {
      newPath.name = name;
    }
    return {
      programMemory: {
        ...programMemory,
        _sketch: [...(programMemory?._sketch || []), newPath],
      },
      currentPath: newPath,
    };
  },
  lineTo: (
    programMemory: ProgramMemory,
    name: string = "",
    ...args: any[]
  ): PathReturn => {
    const _programMemory = addBasePath(programMemory);
    const [x, y] = args;
    if (!_programMemory._sketch) {
      throw new Error("No sketch to draw on");
    }
    const lastPath: Path =
      _programMemory._sketch[_programMemory._sketch.length - 1];
    const currentPath: Path = {
      type: "toPoint",
      to: [x, y],
      previousPath: lastPath,
    };
    if (name) {
      currentPath.name = name;
    }
    return {
      programMemory: {
        ..._programMemory,
        _sketch: [...(_programMemory._sketch || []), currentPath],
      },
      currentPath,
    };
  },
};

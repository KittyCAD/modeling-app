import * as vscode from "vscode";

import type { Cmd, CtxInit } from "./ctx";
import { spawnSync } from "child_process";

export function serverVersion(ctx: CtxInit): Cmd {
  return async () => {
    if (!ctx.serverPath) {
      void vscode.window.showWarningMessage(`kcl-language-server server is not running`);
      return;
    }
    const { stdout } = spawnSync(ctx.serverPath, ["--version"], {
      encoding: "utf8",
    });
    const versionString = stdout.slice(`kcl-language-server `.length).trim();

    void vscode.window.showInformationMessage(`kcl-language-server version: ${versionString}`);
  };
}

export function openLogs(ctx: CtxInit): Cmd {
  return async () => {
    if (ctx.client.outputChannel) {
      ctx.client.outputChannel.show();
    }
  };
}

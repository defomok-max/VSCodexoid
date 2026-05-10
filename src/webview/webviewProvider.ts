import * as vscode from "vscode";
import { logger } from "../core/util/logger";
import type { HostToWebview, WebviewToHost } from "../shared/protocol";

/**
 * Renders the React webview in the NexusCode sidebar and proxies messages
 * between the host extension and the webview UI.
 */
export class NexusWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexuscode.chat";

  private view: vscode.WebviewView | undefined;
  private listeners = new Set<(msg: WebviewToHost) => void>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void | Thenable<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((raw) => {
      const msg = raw as WebviewToHost;
      for (const l of this.listeners) {
        try {
          l(msg);
        } catch (e) {
          logger.error("listener error", e);
        }
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  onMessage(listener: (msg: WebviewToHost) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  postMessage(msg: HostToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  reveal(): void {
    this.view?.show?.(true);
  }

  private renderHtml(webview: vscode.Webview): string {
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, "main.js"));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, "main.css"));
    const nonce = nonceString();
    const cspSource = webview.cspSource;
    return BASE_HTML
      .replace(/\$\{cspSource\}/g, cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace("${cssUri}", cssUri.toString())
      .replace("${jsUri}", jsUri.toString());
  }
}

function nonceString(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

const BASE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src \${cspSource} https: data:; script-src 'nonce-\${nonce}'; style-src \${cspSource} 'unsafe-inline'; font-src \${cspSource} https: data:; connect-src https: http: ws: wss:;" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NexusCode</title>
    <link rel="stylesheet" href="\${cssUri}" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full"></div>
    <script nonce="\${nonce}" src="\${jsUri}"></script>
  </body>
</html>`;

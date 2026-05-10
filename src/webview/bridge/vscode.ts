import type { WebviewToHost } from "../../shared/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (api) return api;
  if (typeof acquireVsCodeApi === "function") {
    api = acquireVsCodeApi();
    return api;
  }
  // Fallback for development outside the host (e.g. browser preview).
  api = {
    postMessage: (m) => {
      // eslint-disable-next-line no-console
      console.debug("[nexus:vscode-mock] postMessage", m);
    },
    getState: () => undefined,
    setState: () => {
      /* noop */
    },
  };
  return api;
}

export const vscode = {
  postMessage(message: WebviewToHost) {
    getApi().postMessage(message);
  },
};

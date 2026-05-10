// Minimal mock of the `vscode` module so unit tests of `core/*` modules can
// import the real source without spinning up an extension host.

export class Disposable {
  constructor(private readonly fn: () => void) {}
  dispose(): void {
    this.fn();
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  event = (listener: (e: T) => void) => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(value: T): void {
    for (const l of this.listeners) l(value);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

const cfgStore = new Map<string, unknown>();

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => (cfgStore.get(key) as T) ?? (defaultValue as T),
    update: async (key: string, value: unknown) => {
      cfgStore.set(key, value);
    },
    has: (key: string) => cfgStore.has(key),
  }),
  onDidChangeConfiguration: () => new Disposable(() => undefined),
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
  },
};

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (_s: string) => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
};

export const commands = {
  registerCommand: () => new Disposable(() => undefined),
  executeCommand: async () => undefined,
};

export class Uri {
  constructor(public readonly scheme: string, public readonly path: string) {}
  static file(p: string) {
    return new Uri("file", p);
  }
  static joinPath(uri: Uri, ...parts: string[]) {
    return new Uri(uri.scheme, [uri.path, ...parts].join("/"));
  }
  with(): Uri {
    return this;
  }
  toString() {
    return `${this.scheme}://${this.path}`;
  }
  get fsPath(): string {
    return this.path;
  }
}

export interface Memento {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Promise<void>;
}

export class MockMemento implements Memento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T {
    return (this.store.get(key) as T) ?? (defaultValue as T);
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

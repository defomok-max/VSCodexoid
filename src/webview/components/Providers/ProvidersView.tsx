import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { ProviderProfile, ProviderType } from "../../../shared/types";

const PROVIDER_TYPES: ProviderType[] = [
  "openai-compatible",
  "anthropic",
  "google-gemini",
  "ollama",
  "lm-studio",
  "localai",
  "azure-openai",
  "aws-bedrock",
  "openrouter",
  "groq",
  "mistral",
  "deepseek",
  "xai",
  "together",
  "fireworks",
  "perplexity",
  "cohere",
  "huggingface",
  "custom-http",
];

export function ProvidersView() {
  const providers = useAppStore((s) => s.state.providers);
  const models = useAppStore((s) => s.state.models);
  const send = useAppStore((s) => s.send);
  const settings = useAppStore((s) => s.state.settings);
  const [draftKey, setDraftKey] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const updateProfile = (id: string, patch: Partial<ProviderProfile>) => {
    const next = providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
    send({ type: "providers/save", profiles: next });
  };

  const removeProfile = (id: string) => {
    if (!confirm(`Delete provider "${id}"?`)) return;
    send({ type: "providers/save", profiles: providers.filter((p) => p.id !== id) });
  };

  const addProfile = () => {
    const id = `provider-${Date.now().toString(36)}`;
    const fresh: ProviderProfile = {
      id,
      name: "New provider",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com",
      apiKeySecretRef: id,
      defaultModel: "",
      streaming: true,
    };
    send({ type: "providers/save", profiles: [...providers, fresh] });
    setEditing(id);
  };

  return (
    <div className="h-full overflow-auto px-6 py-5 max-w-4xl">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold">Providers</h2>
        <div className="flex-1" />
        <button className="nx-btn nx-btn-soft" onClick={addProfile}>
          + Add provider
        </button>
      </div>
      <p className="text-sm text-nexus-muted mb-4">
        API keys live in VS Code <code>SecretStorage</code> — never on disk and never logged. Click
        <span className="font-medium"> Refresh models</span> to fetch each profile's live model list.
      </p>
      <div className="space-y-3">
        {providers.map((p) => {
          const isDefault = settings.defaultProviderId === p.id;
          const isOpen = editing === p.id;
          return (
            <div key={p.id} className="nx-card p-3">
              <div className="flex items-center gap-2">
                <span className="nx-tag">{p.type}</span>
                <span className="font-medium">{p.name}</span>
                {isDefault && <span className="nx-tag" style={{ color: "var(--nexus-accent)" }}>default</span>}
                <div className="flex-1" />
                <button
                  className="nx-btn nx-btn-ghost text-xs"
                  onClick={() => send({ type: "providers/refreshModels", profileId: p.id })}
                >
                  Refresh models
                </button>
                <button
                  className="nx-btn nx-btn-ghost text-xs"
                  onClick={() => setEditing(isOpen ? null : p.id)}
                >
                  {isOpen ? "Close" : "Edit"}
                </button>
                <button className="nx-btn nx-btn-ghost text-xs" onClick={() => removeProfile(p.id)}>
                  Delete
                </button>
              </div>
              {p.baseUrl && (
                <div className="text-[12px] font-mono text-nexus-muted mt-1">{p.baseUrl}</div>
              )}
              <div className="text-[12px] text-nexus-muted mt-1">
                Default model:{" "}
                <span className="font-mono">{p.defaultModel ?? "—"}</span>
                {(models[p.id]?.length ?? 0) > 0 && (
                  <span className="ml-2">· {models[p.id]!.length} models loaded</span>
                )}
              </div>

              {isOpen && (
                <div className="mt-3 grid grid-cols-2 gap-3 animate-fadeIn">
                  <Field label="Name">
                    <input
                      className="nx-input"
                      value={p.name}
                      onChange={(e) => updateProfile(p.id, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Type">
                    <select
                      className="nx-input"
                      value={p.type}
                      onChange={(e) => updateProfile(p.id, { type: e.target.value as ProviderType })}
                    >
                      {PROVIDER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Base URL">
                    <input
                      className="nx-input"
                      value={p.baseUrl ?? ""}
                      onChange={(e) => updateProfile(p.id, { baseUrl: e.target.value })}
                    />
                  </Field>
                  <Field label="Default model">
                    <ModelSelect
                      value={p.defaultModel ?? ""}
                      models={models[p.id] ?? []}
                      onChange={(v) => updateProfile(p.id, { defaultModel: v })}
                    />
                  </Field>
                  <Field label="API key">
                    <div className="flex gap-2">
                      <input
                        className="nx-input"
                        type="password"
                        placeholder="•••••••••••••"
                        value={draftKey[p.id] ?? ""}
                        onChange={(e) => setDraftKey({ ...draftKey, [p.id]: e.target.value })}
                      />
                      <button
                        className="nx-btn nx-btn-soft"
                        onClick={() => {
                          const v = draftKey[p.id] ?? "";
                          if (!v) return;
                          send({ type: "providers/secret", profileId: p.id, apiKey: v });
                          setDraftKey({ ...draftKey, [p.id]: "" });
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </Field>
                  <Field label="Set as default">
                    <button
                      className="nx-btn nx-btn-soft"
                      onClick={() =>
                        send({
                          type: "settings/save",
                          partial: {
                            defaultProviderId: p.id,
                            defaultModelId: p.defaultModel ?? settings.defaultModelId,
                          },
                        })
                      }
                      disabled={isDefault}
                    >
                      {isDefault ? "Default" : "Make default"}
                    </button>
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <div className="text-nexus-muted mb-1">{label}</div>
      {children}
    </label>
  );
}

function ModelSelect({
  value,
  models,
  onChange,
}: {
  value: string;
  models: { id: string }[];
  onChange: (v: string) => void;
}) {
  if (models.length === 0) {
    return <input className="nx-input" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <select className="nx-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
        </option>
      ))}
    </select>
  );
}

import { useAppStore } from "../../stores/appStore";
import type { ApprovalPolicy, ReasoningEffort, Theme } from "../../../shared/types";

export function SettingsView() {
  const settings = useAppStore((s) => s.state.settings);
  const send = useAppStore((s) => s.send);

  const set = (partial: Partial<typeof settings>) =>
    send({ type: "settings/save", partial });

  return (
    <div className="h-full overflow-auto px-6 py-5 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Settings</h2>

      <Section title="Appearance">
        <Row label="Theme">
          <select
            className="nx-input"
            value={settings.ui.theme}
            onChange={(e) => set({ ui: { ...settings.ui, theme: e.target.value as Theme } })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </Row>
        <Row label="Compact mode">
          <Toggle
            value={settings.ui.compactMode}
            onChange={(v) => set({ ui: { ...settings.ui, compactMode: v } })}
          />
        </Row>
        <Row label="Animations">
          <Toggle
            value={settings.ui.animations}
            onChange={(v) => set({ ui: { ...settings.ui, animations: v } })}
          />
        </Row>
      </Section>

      <Section title="Agent">
        <Row label="Approval policy">
          <select
            className="nx-input"
            value={settings.approvalPolicy}
            onChange={(e) => set({ approvalPolicy: e.target.value as ApprovalPolicy })}
          >
            <option value="manual">Manual</option>
            <option value="balanced">Balanced</option>
            <option value="auto-safe">Auto-safe</option>
            <option value="full-auto">Full-auto</option>
          </select>
        </Row>
        <Row label="Reasoning effort">
          <select
            className="nx-input"
            value={settings.reasoningEffort}
            onChange={(e) => set({ reasoningEffort: e.target.value as ReasoningEffort })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="extreme">Extreme</option>
          </select>
        </Row>
      </Section>

      <Section title="Queue">
        <Row label="Auto-send next queued message">
          <Toggle
            value={settings.queue.autoSendNext}
            onChange={(v) => set({ queue: { ...settings.queue, autoSendNext: v } })}
          />
        </Row>
        <Row label="Allow interrupting current run">
          <Toggle
            value={settings.queue.allowInterrupt}
            onChange={(v) => set({ queue: { ...settings.queue, allowInterrupt: v } })}
          />
        </Row>
        <Row label="Preserve context between queued tasks">
          <Toggle
            value={settings.queue.preserveContext}
            onChange={(v) => set({ queue: { ...settings.queue, preserveContext: v } })}
          />
        </Row>
        <Row label="Summarize previous run before next">
          <Toggle
            value={settings.queue.summarizePreviousRun}
            onChange={(v) => set({ queue: { ...settings.queue, summarizePreviousRun: v } })}
          />
        </Row>
      </Section>

      <Section title="Custom instructions">
        <textarea
          className="nx-input min-h-[120px]"
          value={settings.customInstructions}
          onChange={(e) => set({ customInstructions: e.target.value })}
          placeholder="Project-specific rules to inject into the system prompt…"
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nx-card p-4 mb-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-nexus-muted w-56 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`w-10 h-6 rounded-full transition-colors ${value ? "bg-nexus-accent" : "bg-nexus-border"}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      <span
        className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
          value ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

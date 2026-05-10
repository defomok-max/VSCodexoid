import { useAppStore } from "../../stores/appStore";

export function SkillsView() {
  const skills = useAppStore((s) => s.state.skills);
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <h2 className="text-lg font-semibold mb-3">Skills</h2>
      <p className="text-sm text-nexus-muted mb-4">
        Skills are reusable instructions, allowed tool sets, and workflows. Edit
        <code className="mx-1">.nexus/skills/*.skill.json</code>
        to create your own.
      </p>
      <div className="space-y-2">
        {skills.map((s) => (
          <div key={s.id} className="nx-card p-3">
            <div className="flex items-center gap-2">
              <span className="nx-tag">{s.source ?? "built-in"}</span>
              <span className="font-medium">{s.name}</span>
              <div className="flex-1" />
              <span className="nx-tag">{s.enabled === false ? "disabled" : "enabled"}</span>
            </div>
            <p className="text-xs text-nexus-muted mt-1">{s.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

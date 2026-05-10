import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../../stores/appStore";
import type { SkillDefinition } from "../../../shared/types";

export function SkillsView() {
  const skills = useAppStore((s) => s.state.skills);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.triggers?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [skills, filter]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold mb-1">Skills</h2>
        <p className="text-sm text-nexus-muted mb-4">
          Skills are reusable instructions, allowed-tool sets, and workflows. Edit{" "}
          <code className="px-1 py-0.5 rounded bg-nexus-surface-2 border border-nexus-border">.nexus/skills/*.skill.json</code>{" "}
          to add your own. {skills.length} loaded.
        </p>
        <input
          className="nx-input mb-4"
          placeholder="Filter by name, id, trigger…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="space-y-2">
          {filtered.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              open={expanded.has(s.id)}
              onToggle={() => toggle(s.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="text-sm text-nexus-muted py-8 text-center">No skills match your filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCard({ skill, open, onToggle }: { skill: SkillDefinition; open: boolean; onToggle: () => void }) {
  return (
    <motion.div
      initial={false}
      animate={{ backgroundColor: open ? "rgba(0,0,0,0)" : "rgba(0,0,0,0)" }}
      className="nx-card overflow-hidden"
    >
      <button onClick={onToggle} className="w-full px-3 py-3 text-left flex items-start gap-2">
        <span className="nx-tag mt-0.5">{skill.source ?? "built-in"}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{skill.name}</div>
          <div className="text-xs text-nexus-muted truncate">{skill.description}</div>
          {skill.triggers && skill.triggers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {skill.triggers.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-1.5 py-[1px] rounded font-mono border border-nexus-border bg-nexus-surface-2"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="nx-tag mt-0.5">{skill.enabled === false ? "disabled" : "enabled"}</span>
        <span className="text-nexus-muted ml-1">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-nexus-border">
          {skill.instructions && skill.instructions.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-nexus-muted mt-2 mb-1">Instructions</div>
              <ol className="list-decimal pl-5 text-xs space-y-0.5">
                {skill.instructions.map((i, k) => <li key={k}>{i}</li>)}
              </ol>
            </div>
          )}
          {skill.workflow && skill.workflow.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1">Workflow</div>
              <div className="text-xs flex flex-wrap gap-1">
                {skill.workflow.map((w, k) => (
                  <span key={k} className="px-1.5 py-[1px] rounded font-mono border border-nexus-border bg-nexus-surface-2">
                    {w}{k < (skill.workflow?.length ?? 0) - 1 ? " →" : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {skill.allowedTools && skill.allowedTools.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1">Allowed tools</div>
              <div className="text-xs flex flex-wrap gap-1">
                {skill.allowedTools.map((t) => (
                  <span key={t} className="px-1.5 py-[1px] rounded font-mono border border-nexus-border bg-nexus-surface-2">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {skill.outputFormat && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1">Output format</div>
              <div className="text-xs">{skill.outputFormat}</div>
            </div>
          )}
          {skill.safetyConstraints && skill.safetyConstraints.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-nexus-muted mb-1">Safety</div>
              <ul className="list-disc pl-5 text-xs space-y-0.5 text-nexus-muted">
                {skill.safetyConstraints.map((c, k) => <li key={k}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

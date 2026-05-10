import { useAppStore } from "../../stores/appStore";

export function ApprovalDialog() {
  const req = useAppStore((s) => s.state.pendingApproval);
  const send = useAppStore((s) => s.send);
  if (!req) return null;
  const decide = (approved: boolean) =>
    send({ type: "approval/decide", decision: { id: req.id, approved } });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 animate-fadeIn">
      <div className="nx-card w-[420px] p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="nx-tag" data-risk={req.riskLevel}>
            risk: {req.riskLevel}
          </span>
          <h2 className="text-base font-semibold">Approval requested</h2>
        </div>
        <p className="text-sm text-nexus-muted mb-2">
          The agent wants to call <span className="font-mono text-nexus-text">{req.toolName}</span>.
        </p>
        {req.command && (
          <pre className="text-[12px] bg-nexus-surface-2 border border-nexus-border rounded-lg p-2 overflow-x-auto">
            {req.command}
          </pre>
        )}
        <pre className="text-[12px] bg-nexus-surface-2 border border-nexus-border rounded-lg p-2 mt-2 overflow-x-auto whitespace-pre-wrap">
          {req.argsPreview}
        </pre>
        {req.affectedFiles && req.affectedFiles.length > 0 && (
          <div className="mt-3 text-xs text-nexus-muted">
            <div className="font-medium text-nexus-text mb-1">Affected files</div>
            <ul className="list-disc pl-4">
              {req.affectedFiles.map((f) => (
                <li key={f} className="font-mono">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {req.rationale && <p className="text-xs text-nexus-muted mt-3">{req.rationale}</p>}
        <div className="mt-4 flex gap-2 justify-end">
          <button className="nx-btn nx-btn-soft" onClick={() => decide(false)}>
            Reject
          </button>
          <button className="nx-btn nx-btn-primary" onClick={() => decide(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

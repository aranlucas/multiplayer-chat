import { Check, ShieldAlert, X } from "lucide-react";
import type { PermissionRequest } from "../../shared/protocol";
import { formatTime } from "../event-display";

interface PermissionCardProps {
  permission: PermissionRequest;
  canApprove: boolean;
  onReply: (id: string, reply: "once" | "reject") => void;
  compact?: boolean;
}

export function PermissionCard({ permission, canApprove, onReply, compact = false }: PermissionCardProps) {
  const pending = permission.status === "pending";
  return (
    <article className={`permission-card ${compact ? "is-compact" : ""} permission-${permission.status}`}>
      <div className="permission-heading">
        <ShieldAlert size={17} />
        <strong>{permission.action}</strong>
        <span>{permission.status}</span>
      </div>
      {!compact ? <p>{permission.message ?? "This side effect needs maintainer approval."}</p> : null}
      {!compact ? <code>$ {permission.action} --env production</code> : null}
      {!compact ? (
        <div className="permission-meta">
          <span>Requested by OpenCode</span>
          <span>{formatTime(permission.createdAt)}</span>
        </div>
      ) : null}
      {!compact && pending ? <small>Needs maintainer approval</small> : null}
      {pending ? (
        <div className="permission-actions">
          <button type="button" onClick={() => onReply(permission.id, "once")} disabled={!canApprove}>
            <Check size={16} /> Approve
          </button>
          {!compact ? (
            <button className="deny" type="button" onClick={() => onReply(permission.id, "reject")} disabled={!canApprove}>
              <X size={16} /> Deny
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

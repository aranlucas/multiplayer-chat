import { Check, ChevronDown, GitBranch, GitPullRequest, LoaderCircle, MessageSquarePlus, Pause, Share2, Zap } from "lucide-react";
import { useState } from "react";
import { DEFAULT_BRANCH, DEFAULT_REPOSITORY, type Participant, type RoomInfo } from "../../shared/protocol";

interface HeaderProps {
  room?: RoomInfo;
  participants: Participant[];
  connection: "connecting" | "connected" | "reconnecting" | "offline";
  githubConfigured: boolean;
  githubLogin?: string;
  creatingPullRequest: boolean;
  pullRequestURL?: string;
  onPullRequest: () => void;
  onNewThread: () => void;
  onPause: () => void;
  canConfigure: boolean;
  onConfigure: (repository: string, branch: string) => boolean;
}

export function Header({
  room,
  participants,
  connection,
  githubConfigured,
  githubLogin,
  creatingPullRequest,
  pullRequestURL,
  onPullRequest,
  onNewThread,
  onPause,
  canConfigure,
  onConfigure,
}: HeaderProps) {
  const [copied, setCopied] = useState(false);
  const [editingRepository, setEditingRepository] = useState(false);
  const [repository, setRepository] = useState(room?.repository ?? DEFAULT_REPOSITORY);
  const [branch, setBranch] = useState(room?.branch ?? DEFAULT_BRANCH);
  const online = participants.filter((participant) => participant.online);
  const running = room?.agentStatus === "running";

  async function share() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  function configureRepository(event: React.FormEvent) {
    event.preventDefault();
    if (onConfigure(repository.trim(), branch.trim())) setEditingRepository(false);
  }

  return (
    <header className="app-header">
      <div className="brand">
        <Zap size={22} strokeWidth={2.1} aria-hidden />
        <span>Relay</span>
      </div>
      <button
        className="header-context repository-context"
        type="button"
        disabled={!canConfigure}
        onClick={() => {
          setRepository(room?.repository ?? repository);
          setBranch(room?.branch ?? branch);
          setEditingRepository((current) => !current);
        }}
      >
        <span className="repository-icon">▦</span>
        <span>{room?.repository ?? DEFAULT_REPOSITORY}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      <div className="header-context branch-context">
        <GitBranch size={16} aria-hidden />
        <span>{room?.branch ?? DEFAULT_BRANCH}</span>
        <ChevronDown size={14} aria-hidden />
      </div>
      {editingRepository ? (
        <form className="repository-popover" onSubmit={configureRepository}>
          <strong>GitHub workspace</strong>
          <label>
            Public repository
            <input
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repository"
              autoFocus
            />
          </label>
          <label>
            Branch
            <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" />
          </label>
          <div>
            <button type="button" onClick={() => setEditingRepository(false)}>
              Cancel
            </button>
            <button type="submit" disabled={!repository.trim() || !branch.trim()}>
              Clone workspace
            </button>
          </div>
        </form>
      ) : null}
      <div className="header-context session-context">
        <span>{room?.title ?? "Investigate reconnect loop"}</span>
        <ChevronDown size={14} aria-hidden />
      </div>
      <div className="header-spacer" />
      <div className={`agent-state ${running ? "is-running" : ""}`}>
        <span className="status-dot" />
        <span>
          {connection === "reconnecting"
            ? "Reconnecting"
            : room?.workspaceStatus === "cloning"
              ? "Cloning repository"
              : room?.workspaceStatus === "error"
                ? "Workspace error"
                : running
              ? "Agent running"
              : room?.agentStatus === "paused"
                ? "Agent paused"
                : "Agent ready"}
        </span>
      </div>
      <div className="header-avatars" aria-label={`${online.length} participants online`}>
        {online.slice(0, 4).map((participant) => (
          <span
            className="avatar avatar-small"
            key={participant.id}
            style={{ "--avatar": participant.color } as React.CSSProperties}
            title={participant.name}
          >
            {participant.name.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <button className="header-button new-thread-button" type="button" onClick={onNewThread}>
        <MessageSquarePlus size={16} />
        <span>New thread</span>
      </button>
      <button
        className="header-button pr-button"
        type="button"
        onClick={onPullRequest}
        disabled={!githubConfigured || creatingPullRequest || room?.workspaceStatus !== "ready"}
        title={githubLogin ? `GitHub: @${githubLogin}` : "Connect GitHub to create a pull request"}
      >
        {creatingPullRequest ? <LoaderCircle className="spin" size={16} /> : <GitPullRequest size={16} />}
        <span>{pullRequestURL ? "View PR" : githubLogin ? "Create PR" : "Connect GitHub"}</span>
      </button>
      <button className="header-button" type="button" onClick={share}>
        {copied ? <Check size={16} /> : <Share2 size={16} />}
        <span>{copied ? "Copied" : "Share"}</span>
      </button>
      <button className="header-button pause-button" type="button" onClick={onPause} disabled={!running}>
        <Pause size={16} />
        <span>Pause agent</span>
      </button>
    </header>
  );
}

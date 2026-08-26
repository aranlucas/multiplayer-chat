import { CircleHelp, Clock3, GitBranch, MessageSquareText, Settings, TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { getIdentity, useRoom } from "./use-room";
import { useGitHub } from "./use-github";
import { ActivityRail } from "./components/ActivityRail";
import { CollaborationRail } from "./components/CollaborationRail";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { MobileTabs, type MobileTab } from "./components/MobileTabs";
import { Transcript } from "./components/Transcript";

const roomID = window.location.pathname.match(/^\/r\/([^/]+)/)?.[1] ?? "reconnect-loop";

function createThread() {
  const nextRoomID = `session-${crypto.randomUUID()}`;
  window.location.assign(`/r/${nextRoomID}${window.location.search}`);
}

export function App() {
  const identity = useMemo(() => getIdentity(roomID), []);
  const { state, actions } = useRoom(roomID, identity);
  const github = useGitHub(roomID);
  const [selectedID, setSelectedID] = useState<string>();
  const [mobileTab, setMobileTab] = useState<MobileTab>("transcript");
  const pendingPermission = state.permissions.find((permission) => permission.status === "pending");
  const canApprove = identity.role === "maintainer";

  function reply(id: string, response: "once" | "reject") {
    actions.reply(id, response);
  }

  async function handlePullRequest() {
    if (state.room?.pullRequestURL) {
      window.open(state.room.pullRequestURL, "_blank", "noopener,noreferrer");
      return;
    }
    if (!github.state.authenticated) {
      github.connect();
      return;
    }
    await github.createPullRequest();
  }

  return (
    <div className="app-shell">
      <Header
        room={state.room}
        participants={state.participants}
        connection={state.connection}
        githubConfigured={github.state.configured}
        githubLogin={github.state.user?.login}
        creatingPullRequest={github.state.creating}
        pullRequestURL={state.room?.pullRequestURL}
        onPullRequest={handlePullRequest}
        onNewThread={createThread}
        onPause={actions.pause}
        canConfigure={identity.role === "maintainer"}
        onConfigure={actions.configureRepository}
      />
      <MobileTabs
        active={mobileTab}
        participants={state.participants.length}
        queued={state.queue.length}
        onChange={setMobileTab}
      />
      <aside className="icon-rail" aria-label="Workspace navigation">
        <button className="is-active" type="button" aria-label="Session transcript">
          <MessageSquareText size={19} />
        </button>
        <button type="button" aria-label="Branches">
          <GitBranch size={19} />
        </button>
        <button type="button" aria-label="Files">
          <TerminalSquare size={19} />
        </button>
        <button type="button" aria-label="History">
          <Clock3 size={19} />
        </button>
        <span className="icon-spacer" />
        <button type="button" aria-label="Settings">
          <Settings size={19} />
        </button>
        <button type="button" aria-label="Help">
          <CircleHelp size={19} />
        </button>
      </aside>
      <ActivityRail events={state.events} selectedID={selectedID} onSelect={setSelectedID} />
      <main className={`main-column mobile-tab-${mobileTab}`}>
        {mobileTab === "people" ? (
          <MobilePeople />
        ) : mobileTab === "queue" ? (
          <MobileQueue />
        ) : (
          <Transcript
            events={state.events}
            selectedID={selectedID}
            pendingPermission={pendingPermission}
            canApprove={canApprove}
            onReply={reply}
          />
        )}
        <Composer disabled={state.connection !== "connected"} onSend={actions.prompt} />
      </main>
      <CollaborationRail
        participants={state.participants}
        queue={state.queue}
        permissions={state.permissions}
        events={state.events}
        canApprove={canApprove}
        onReply={reply}
      />
      {state.error || github.state.error ? <div className="error-toast">{state.error ?? github.state.error}</div> : null}
      <div className="sr-only" aria-live="polite">
        {state.connection === "connected" ? "Connected to shared session" : "Reconnecting to shared session"}
      </div>
    </div>
  );

  function MobilePeople() {
    return (
      <section className="mobile-panel">
        <h1>Participants</h1>
        {state.participants.map((participant) => (
          <div className="mobile-person" key={participant.id}>
            <span className="avatar" style={{ "--avatar": participant.color } as React.CSSProperties}>
              {participant.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{participant.name}</strong>
              <span>{participant.role}</span>
            </div>
            <em>{participant.online ? "Online" : "Away"}</em>
          </div>
        ))}
      </section>
    );
  }

  function MobileQueue() {
    return (
      <section className="mobile-panel">
        <h1>Queued follow-ups</h1>
        {state.queue.map((item) => (
          <div className="mobile-queue-item" key={item.eventID}>
            <strong>{item.participant.name}</strong>
            <p>{item.text}</p>
          </div>
        ))}
        {!state.queue.length ? <p className="empty-copy">Nothing queued yet.</p> : null}
      </section>
    );
  }
}

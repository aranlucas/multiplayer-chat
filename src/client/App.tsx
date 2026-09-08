import { usePreviewHandoff } from "./use-preview-handoff";
import type { Participant, QueuedPrompt } from "../shared/protocol";
import { useEffect, useRef, useState } from "react";
import { useRoom } from "./use-room";
import { useGitHub } from "./use-github";
import { createThread, type RelayBootstrap } from "./room-bootstrap";
import { ActivityRail } from "./components/ActivityRail";
import { CollaborationRail } from "./components/CollaborationRail";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { MobileTabs, type MobileTab } from "./components/MobileTabs";
import { Transcript } from "./components/Transcript";
import { ImplementationBrief } from "./components/ImplementationBrief";

export function App({ bootstrap }: { bootstrap: RelayBootstrap }) {
  const { roomID, identity, controlOrigin } = bootstrap;
  const { state, actions } = useRoom(roomID, identity, controlOrigin);
  const github = useGitHub(roomID, controlOrigin);
  const [selectedID, setSelectedID] = useState<string | undefined>(
    () =>
      bootstrap.resumeState?.selectedID ??
      window.sessionStorage.getItem(`relay:${roomID}:selected`) ??
      undefined,
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>(() => {
    if (bootstrap.resumeState?.mobileTab) {
      return bootstrap.resumeState.mobileTab;
    }
    const stored = window.sessionStorage.getItem(`relay:${roomID}:mobile-tab`);
    return stored === "brief" || stored === "people" || stored === "queue" ? stored : "transcript";
  });
  const [draft, setDraft] = useState(
    () =>
      bootstrap.resumeState?.draft ?? window.sessionStorage.getItem(`relay:${roomID}:draft`) ?? "",
  );
  const handoff = usePreviewHandoff({
    roomID,
    controlOrigin,
    identity,
    draft,
    selectedID,
    mobileTab,
    revision: state.room?.latestRevision,
  });
  const { transitioning } = handoff;
  const attemptedPublication = useRef<string | undefined>(undefined);
  const pendingPermission = state.permissions.find((permission) => permission.status === "pending");
  const canApprove = identity.role === "maintainer";

  useEffect(() => {
    const room = state.room;
    if (
      !github.state.authenticated ||
      github.state.creating ||
      github.state.error ||
      room?.agentStatus !== "idle" ||
      room.autoPublishConfigured ||
      room.workspaceRevision <= room.publishedWorkspaceRevision
    ) {
      return;
    }
    const publicationKey = `${roomID}:${room.repository}:${room.branch}:${room.workspaceRevision}`;
    if (attemptedPublication.current === publicationKey) {
      return;
    }
    attemptedPublication.current = publicationKey;
    void github.createPullRequest();
  }, [github, roomID, state.room]);

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
        models={state.models}
        participants={state.participants}
        connection={state.connection}
        githubConfigured={github.state.configured}
        githubLogin={github.state.user?.login}
        creatingPullRequest={github.state.creating}
        pullRequestURL={state.room?.pullRequestURL}
        onPullRequest={() => {
          void handlePullRequest();
        }}
        onNewThread={createThread}
        onPause={actions.pause}
        canConfigure={identity.role === "maintainer"}
        onConfigure={actions.configureRepository}
        onConfigureModel={actions.configureModel}
        onRenameRoom={actions.renameRoom}
      />
      <MobileTabs
        active={mobileTab}
        participants={state.participants.length}
        queued={state.queue.length}
        decisions={state.decisions.length}
        onChange={setMobileTab}
      />
      <ActivityRail events={state.events} selectedID={selectedID} onSelect={setSelectedID} />
      <main className={`main-column mobile-tab-${mobileTab}`}>
        {mobileTab === "brief" ? (
          <ImplementationBrief
            brief={state.brief}
            decisions={state.decisions}
            canEdit={canApprove}
            selectedEventID={selectedID}
            onSelectEvent={(id) => {
              setSelectedID(id);
              setMobileTab("transcript");
            }}
            onUpdate={actions.updateBrief}
            onDecision={actions.createDecision}
            onStartReview={actions.startBriefReview}
            onReviewComment={actions.commentOnBrief}
            onResolveReview={actions.resolveBriefReview}
            mobile
          />
        ) : mobileTab === "people" ? (
          <MobilePeople participants={state.participants} />
        ) : mobileTab === "queue" ? (
          <MobileQueue queue={state.queue} />
        ) : (
          <Transcript
            events={state.events}
            selectedID={selectedID}
            pendingPermission={pendingPermission}
            canApprove={canApprove}
            onReply={reply}
            onQuestionReply={actions.answerQuestion}
            onQuestionCancel={actions.dismissQuestion}
          />
        )}
        <Composer
          disabled={state.connection !== "connected" || transitioning}
          text={draft}
          onTextChange={setDraft}
          onSend={actions.prompt}
        />
      </main>
      <CollaborationRail
        participants={state.participants}
        queue={state.queue}
        permissions={state.permissions}
        events={state.events}
        canApprove={canApprove}
        onReply={reply}
        brief={state.brief}
        decisions={state.decisions}
        selectedEventID={selectedID}
        onSelectEvent={setSelectedID}
        onUpdateBrief={actions.updateBrief}
        onDecision={actions.createDecision}
        onStartReview={actions.startBriefReview}
        onReviewComment={actions.commentOnBrief}
        onResolveReview={actions.resolveBriefReview}
      />
      {state.error || github.state.error ? (
        <div className="error-toast">{state.error ?? github.state.error}</div>
      ) : null}
      {handoff.error ? (
        <div role="alert" className="error-toast">
          {handoff.error}{" "}
          <button type="button" onClick={handoff.retry}>
            Retry preview
          </button>
        </div>
      ) : null}
      {transitioning ? (
        <div className="room-transition" role="status">
          <span className="transition-pulse" />
          Preview ready. Moving this room to revision {state.room?.latestRevision?.sequence}…
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {state.connection === "connected"
          ? "Connected to shared session"
          : state.connection === "connecting"
            ? "Connecting to shared session"
            : "Reconnecting to shared session"}
      </div>
    </div>
  );
}

function MobilePeople({ participants }: { participants: Participant[] }) {
  return (
    <section className="mobile-panel">
      <h1>Participants</h1>
      {participants.map((participant) => (
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

function MobileQueue({ queue }: { queue: QueuedPrompt[] }) {
  return (
    <section className="mobile-panel">
      <h1>Queued follow-ups</h1>
      {queue.map((item) => (
        <div className="mobile-queue-item" key={item.eventID}>
          <strong>{item.participant.name}</strong>
          <p>{item.text}</p>
        </div>
      ))}
      {!queue.length ? <p className="empty-copy">Nothing queued yet.</p> : null}
    </section>
  );
}

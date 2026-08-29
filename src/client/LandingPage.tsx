import {
  Activity,
  ArrowRight,
  Boxes,
  GitBranch,
  GitPullRequest,
  Layers,
  MessageSquarePlus,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { createThread } from "./room-bootstrap";

const features = [
  {
    icon: Activity,
    title: "One shared event stream",
    body: "Every OpenCode session event, tool call, and diff is ordered once and streamed to all participants in real time.",
  },
  {
    icon: Users,
    title: "Multiplayer presence",
    body: "Join from any tab or device. See who is online and steer the same agent together without clobbering each other.",
  },
  {
    icon: MessageSquarePlus,
    title: "Steer or queue",
    body: "Send a prompt to the agent immediately, or queue a follow-up so it picks up the next turn exactly where you left off.",
  },
  {
    icon: GitPullRequest,
    title: "One-click pull requests",
    body: "Connect GitHub and ship room changes straight to a pull request — each turn appends a commit to the same branch.",
  },
  {
    icon: GitBranch,
    title: "Exact-commit previews",
    body: "Every revision is pinned to a commit and tracked through a live preview, with seamless handoff to the deployed build.",
  },
  {
    icon: Boxes,
    title: "Hardware-isolated",
    body: "OpenCode lives with the room in a Durable Object while shell and file tools run in a persistent per-room Railway sandbox.",
  },
];

const steps = [
  {
    icon: Zap,
    title: "Open a room",
    body: "Start a thread and Relay spins up a durable room with its own agent workspace, cloned from any public repository.",
  },
  {
    icon: Users,
    title: "Collaborate live",
    body: "Everyone shares one ordered transcript, live presence, and a queue of follow-ups against the same agent.",
  },
  {
    icon: GitPullRequest,
    title: "Ship the work",
    body: "Publish an exact-commit preview and open a pull request without ever leaving the room.",
  },
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <Zap size={20} strokeWidth={2.1} aria-hidden />
          <span>Relay</span>
        </div>
        <nav className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="/r/reconnect-loop">Live room</a>
        </nav>
        <button
          className="button-primary landing-nav-cta"
          onClick={createThread}
        >
          Start a thread
        </button>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">
              <Zap size={13} aria-hidden /> Multiplayer coding-agent room
            </span>
            <h1>
              Code with an AI agent —{" "}
              <span className="accent">together, in real time.</span>
            </h1>
            <p className="landing-lead">
              Relay is a shared room where people and an OpenCode agent work on
              the same repository at once. One ordered event stream, live
              presence, queued prompts, and one-click pull requests — all inside
              a hardware-isolated workspace.
            </p>
            <div className="landing-actions">
              <button className="button-primary" onClick={createThread}>
                Start a thread <ArrowRight size={16} />
              </button>
              <a className="button-ghost" href="/r/reconnect-loop">
                Open a live room
              </a>
            </div>
            <ul className="landing-trust">
              <li>
                <ShieldCheck size={15} aria-hidden /> Hardware-isolated microVM
              </li>
              <li>
                <GitBranch size={15} aria-hidden /> Exact-commit previews
              </li>
              <li>
                <Users size={15} aria-hidden /> Multiplayer presence
              </li>
            </ul>
          </div>
          <RelayMock />
        </section>

        <section id="features" className="landing-section">
          <div className="section-head">
            <h2>Everything a shared agent room needs</h2>
            <p>
              Relay keeps OpenCode authoritative and gives every participant the
              same view of the work — from the first prompt to the merged pull
              request.
            </p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-icon">
                  <feature.icon size={18} aria-hidden />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="landing-section landing-section-alt">
          <div className="section-head">
            <h2>From empty room to shipped PR in three steps</h2>
            <p>
              No setup, no client to install. Open a link and start building.
            </p>
          </div>
          <div className="steps">
            {steps.map((step, index) => (
              <div className="step" key={step.title}>
                <span className="step-index">{index + 1}</span>
                <span className="step-icon">
                  <step.icon size={18} aria-hidden />
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-cta-band">
          <div className="cta-glow" aria-hidden />
          <Layers size={26} className="cta-mark" aria-hidden />
          <h2>Open a room and start building.</h2>
          <p>Spin up a fresh agent workspace and invite anyone with a link.</p>
          <button className="button-primary button-lg" onClick={createThread}>
            Start a thread <ArrowRight size={17} />
          </button>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="brand">
          <Zap size={18} strokeWidth={2.1} aria-hidden />
          <span>Relay</span>
        </div>
        <p>
          Multiplayer coding-agent rooms on Cloudflare Durable Objects and
          Railway Sandbox.
        </p>
        <a className="landing-footer-link" href="/r/reconnect-loop">
          Try a live room <ArrowRight size={14} />
        </a>
      </footer>
    </div>
  );
}

function RelayMock() {
  return (
    <div className="mock" aria-hidden>
      <div className="mock-bar">
        <span className="mock-dots">
          <i />
          <i />
          <i />
        </span>
        <div className="mock-url">relay.dev/r/session-8f3c…</div>
      </div>
      <div className="mock-shell">
        <aside className="mock-activity">
          <div className="mock-rail-head">Activity</div>
          <div className="mock-activity-row">
            <span className="mock-time">12:04</span>
            <span className="mock-ic mock-ic-prompt">›</span>
            <div>
              <strong>Mara</strong>
              <span>Add rate-limit middleware</span>
            </div>
          </div>
          <div className="mock-activity-row">
            <span className="mock-time">12:05</span>
            <span className="mock-ic mock-ic-tool">⌘</span>
            <div>
              <strong>agent</strong>
              <span>edit auth/server.ts</span>
            </div>
          </div>
          <div className="mock-activity-row">
            <span className="mock-time">12:06</span>
            <span className="mock-ic mock-ic-text">✦</span>
            <div>
              <strong>Sam</strong>
              <span>Reject empty passwords</span>
            </div>
          </div>
        </aside>

        <div className="mock-main">
          <div className="mock-event mock-event-prompt">
            <div className="mock-gutter">
              <span className="mock-marker">›</span>
            </div>
            <div className="mock-body">
              <div className="mock-head">
                <strong>Sam</strong>
                <span className="mock-role">maintainer</span>
              </div>
              <p>Make the login endpoint reject empty passwords.</p>
            </div>
          </div>
          <div className="mock-event mock-event-tool">
            <div className="mock-gutter">
              <span className="mock-marker">⌘</span>
            </div>
            <div className="mock-body">
              <div className="mock-head">
                <strong>agent</strong>
                <span className="mock-tag">bash</span>
              </div>
              <p className="mock-code">$ npm test -- auth</p>
            </div>
          </div>
          <div className="mock-event mock-event-message">
            <div className="mock-gutter">
              <span className="mock-marker">✦</span>
            </div>
            <div className="mock-body">
              <div className="mock-head">
                <strong>agent</strong>
                <span className="mock-tag mock-tag-done">done</span>
              </div>
              <p>
                Added validation and a failing test now passes. Ready for
                review.
              </p>
            </div>
          </div>
          <div className="mock-composer">
            <span>Steer the agent…</span>
            <span className="mock-send">↑</span>
          </div>
        </div>

        <aside className="mock-collab">
          <div className="mock-rail-head">
            People <span>3</span>
          </div>
          <div className="mock-person">
            <span
              className="avatar"
              style={{ "--avatar": "#6685ff" } as React.CSSProperties}
            >
              S
            </span>
            <div>
              <strong>Sam</strong>
              <em>maintainer</em>
            </div>
          </div>
          <div className="mock-person">
            <span
              className="avatar"
              style={{ "--avatar": "#95e853" } as React.CSSProperties}
            >
              M
            </span>
            <div>
              <strong>Mara</strong>
              <em>contributor</em>
            </div>
          </div>
          <div className="mock-person">
            <span
              className="avatar"
              style={{ "--avatar": "#eba62c" } as React.CSSProperties}
            >
              A
            </span>
            <div>
              <strong>agent</strong>
              <em>running</em>
            </div>
          </div>
          <div className="mock-rail-head">
            Queue <span>1</span>
          </div>
          <div className="mock-queue">
            <strong>Mara</strong>
            <p>Wire up the forgot-password flow.</p>
          </div>
          <div className="mock-permission">
            <strong>Allow bash?</strong>
            <code>rm -rf /tmp/cache</code>
            <button className="mock-allow" type="button">
              Allow once
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

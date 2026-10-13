import { ArrowRight, Check, GitBranch, ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";
import { createThread } from "./room-bootstrap";

export function LandingPage() {
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-content">
        Skip to content
      </a>
      <header className="landing-nav">
        <a className="brand" href="/" aria-label="Relay home">
          <Zap size={25} strokeWidth={2.1} aria-hidden />
          <span>Relay</span>
        </a>
        <nav aria-label="Product">
          <a href="#the-room">The room</a>
          <a href="#how">How it works</a>
          <a href="/r/reconnect-loop">
            Open a room <ArrowRight size={16} aria-hidden />
          </a>
        </nav>
      </header>

      <main id="landing-content" tabIndex={-1}>
        <section className="landing-opening" aria-labelledby="relay-title">
          <h1 id="relay-title">
            One agent.
            <br />
            <span>The whole room.</span>
          </h1>
          <div className="landing-introduction">
            <p>
              A shared coding room for people and an OpenCode agent. Work on one repository, steer
              the next move, and see it happen together.
            </p>
            <button className="landing-start" type="button" onClick={createThread}>
              Start a thread <ArrowRight size={22} aria-hidden />
            </button>
          </div>
          <RunningOrder />
        </section>

        <section id="the-room" className="landing-record" aria-labelledby="record-title">
          <h2 id="record-title">
            Everyone sees
            <br />
            the same turn.
          </h2>
          <div className="landing-record-copy">
            <p className="landing-large-copy">
              The prompt, the tool call, the diff. One ordered event stream keeps the whole room in
              the coding loop.
            </p>
            <dl className="landing-facts">
              <div>
                <dt>People</dt>
                <dd>
                  Join by link from another tab or device. See who is online, send a prompt now, or
                  leave the next turn in the queue.
                </dd>
              </div>
              <div>
                <dt>OpenCode</dt>
                <dd>
                  One authoritative agent session lives with the room. Every participant follows the
                  same updates and decisions.
                </dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd>
                  Shell and file tools use a persistent, isolated Railway workspace. Review the
                  changes together, in the room that made them.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="landing-review" aria-labelledby="review-title">
          <div className="landing-review-title">
            <ShieldCheck size={34} aria-hidden />
            <h2 id="review-title">
              Shared work.
              <br />
              Visible decisions.
            </h2>
            <p>
              Tool permissions keep their scope in view. Maintainers can approve once or deny;
              contributors see the same request.
            </p>
          </div>
          <div className="landing-review-proof">
            <p className="landing-example-label">Illustrative permission and revision</p>
            <dl>
              <div>
                <dt>Request</dt>
                <dd>Run the authentication tests</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  <code>pnpm test -- auth</code>
                </dd>
              </div>
              <div>
                <dt>Decision</dt>
                <dd>
                  <Check size={18} aria-hidden /> Approve once, or deny
                </dd>
              </div>
            </dl>
            <div className="landing-revision">
              <GitBranch size={22} aria-hidden />
              <div>
                <h3>One exact commit</h3>
                <p>
                  Track each revision through its preview. Hand off to the verified build, or
                  connect GitHub to publish a pull request.
                </p>
              </div>
            </div>
            <a href="/r/reconnect-loop">
              See the room <ArrowRight size={18} aria-hidden />
            </a>
          </div>
        </section>

        <section id="how" className="landing-how" aria-labelledby="how-title">
          <h2 id="how-title">A link is the invite.</h2>
          <ol>
            <li>
              <h3>Open a room</h3>
              <p>Start a thread and choose a public repository for the shared workspace.</p>
            </li>
            <li>
              <h3>Bring people in</h3>
              <p>
                Share the link. Steer the agent, queue a follow-up, and review the work together.
              </p>
            </li>
            <li>
              <h3>Move the work forward</h3>
              <p>
                Review permissions and diffs, then publish a preview or pull request using the
                room’s configured services.
              </p>
            </li>
          </ol>
        </section>

        <section className="landing-close" aria-labelledby="close-title">
          <h2 id="close-title">
            Make the next
            <br />
            move together.
          </h2>
          <button className="landing-start" type="button" onClick={createThread}>
            Start a thread <ArrowRight size={22} aria-hidden />
          </button>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="brand" href="/" aria-label="Relay home">
          <Zap size={22} aria-hidden />
          <span>Relay</span>
        </a>
        <p>
          Multiplayer coding-agent rooms.
          <br />
          Live tools and publication depend on the room’s configured services.
        </p>
        <a href="/r/reconnect-loop">
          Open a room <ArrowRight size={16} aria-hidden />
        </a>
      </footer>
    </div>
  );
}

function RunningOrder() {
  const [delivery, setDelivery] = useState<"steer" | "queue">("queue");
  const instruction = "Also cover passwords containing only spaces.";

  return (
    <section className="running-order" aria-label="Illustrative shared coding turn">
      <p className="landing-example-label">
        An illustrative room. Synthetic messages, real delivery modes.
      </p>
      <ol>
        <li className="running-prompt">
          <span className="running-sequence" aria-hidden>
            1
          </span>
          <div className="running-person">
            <strong>Sam</strong>
            <span>Maintainer</span>
          </div>
          <div className="running-content">
            <h2>The prompt</h2>
            <p>Reject empty passwords at the login endpoint.</p>
          </div>
          <span className="running-position">Sent</span>
        </li>
        <li className={`running-agent ${delivery === "steer" ? "running-spliced" : ""}`}>
          <span className="running-sequence" aria-hidden>
            2
          </span>
          <div className="running-person">
            <strong>OpenCode</strong>
            <span>Agent</span>
          </div>
          <div className="running-content">
            <h2>The current turn</h2>
            <p>Update the validation. Run the tests. Share the diff.</p>
            {delivery === "steer" ? (
              <p className="running-instruction" key="steer">
                {instruction}
              </p>
            ) : null}
          </div>
          <span className="running-position">Now</span>
        </li>
        <li className={`running-next ${delivery === "queue" ? "running-spliced" : ""}`}>
          <span className="running-sequence" aria-hidden>
            3
          </span>
          <div className="running-person">
            <strong>Mara</strong>
            <span>Contributor</span>
          </div>
          <div className="running-content">
            <h2>The next turn</h2>
            <p>{delivery === "queue" ? instruction : "The next turn is open for a follow-up."}</p>
          </div>
          <span className="running-position">Next</span>
        </li>
      </ol>
      <div className="running-delivery">
        <div>
          <h3>Try the handoff.</h3>
          <p role="status">
            {delivery === "steer"
              ? "The instruction steers the current turn."
              : "The instruction waits in the queue for the next turn."}
          </p>
        </div>
        <div className="running-switch" aria-label="Illustrative prompt delivery" role="group">
          <button
            type="button"
            aria-pressed={delivery === "steer"}
            onClick={() => setDelivery("steer")}
          >
            Steer now <ArrowRight size={17} aria-hidden />
          </button>
          <button
            type="button"
            aria-pressed={delivery === "queue"}
            onClick={() => setDelivery("queue")}
          >
            Queue next <ArrowRight size={17} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}

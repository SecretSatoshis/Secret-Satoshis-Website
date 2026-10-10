"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AgentAvatar, STATE_LABEL, type AgentState } from "../agent-avatar";
import type { ExampleFacts } from "./example-facts";
import { AccessLink, Beta, UNAVAILABLE, type Access } from "./parts";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { UseCases, type LiveExamples } from "./use-cases";
import { WhatItDoes } from "./what-it-does";

// In the hero, "done" is the agent greeting the visitor.
const STATUS: Record<AgentState, string> = { ...STATE_LABEL, done: "Hello" };

// Agent 21 floats in a soft orange glow and reacts to the visitor. Its size
// is set in CSS (.r9-agent), so the server renders it at its final size.
function AgentStage({
  state,
  onHover,
  onPress,
}: {
  state: AgentState;
  onHover: (over: boolean) => void;
  onPress: () => void;
}) {
  return (
    <div className="a21-stage a21-hero-stage">
      <div className="a21-stage-figure">
        <button
          type="button"
          className="r9-agent"
          aria-label="Say hello to Agent 21"
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
          onClick={onPress}
        >
          <AgentAvatar state={state} followPointer float />
        </button>
        <div className="a21-stage-meta">
          <span className="a21-stage-floor" aria-hidden="true" />
          <p className="a21-stage-status" aria-live="polite">
            <i aria-hidden="true" />
            Agent 21 / {STATUS[state]}
          </p>
        </div>
      </div>
    </div>
  );
}

// The Agent 21 landing page, shown to everyone without beta access.
export function Landing({
  access,
  facts,
  live,
}: {
  access: Access;
  /** Figures for the examples that follow the daily release. */
  facts: ExampleFacts;
  /** The live block height and Polymarket ladder. */
  live: LiveExamples;
}) {
  // The hero agent reacts to what the visitor points at.
  const [focus, setFocus] = useState<"agent" | "access" | null>(null);
  const [cheering, setCheering] = useState(false);
  const cheerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(cheerTimer.current), []);
  const agentState: AgentState = cheering
    ? "done"
    : focus === "agent"
      ? "listening"
      : focus === "access"
        ? "done"
        : "idle";
  const cheer = () => {
    clearTimeout(cheerTimer.current);
    setCheering(true);
    cheerTimer.current = setTimeout(() => setCheering(false), 1800);
  };
  const watch = {
    onPointerEnter: () => setFocus("access"),
    onPointerLeave: () => setFocus(null),
    onFocus: () => setFocus("access"),
    onBlur: () => setFocus(null),
  };
  // Section breaks draw their line once, as they scroll into view, the same
  // way the homepage does.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("divider-visible");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    rootRef.current
      ?.querySelectorAll(".section-divider")
      .forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="lp rx" ref={rootRef}>
      <SiteHeader />
      <main>
        {/* The homepage's hero too (css/agent21-face.css): the copy on the
            left, Agent 21 on the right; narrow screens stack head, agent,
            then body. */}
        <section className="r9-hero a21-hero a21-hero-grid">
          <div className="a21-hero-copy">
            <div className="a21-hero-head">
              <p className="a21-hero-label">
                Introducing Agent 21 · Private beta
              </p>
              <h1 className="a21-hero-title">
                The <span className="a21-nowrap">Bitcoin-native</span>{" "}
                <br className="a21-wide-only" />
                AI agent<span className="a21-accent">.</span>
              </h1>
            </div>
            <div className="a21-hero-body">
              <p className="a21-hero-lead">
                Built by Secret Satoshis, Agent 21 understands Bitcoin from
                first principles, reads the blockchain directly, and works
                through your questions the way we would.
              </p>
              {access === "open" && (
                <>
                  <span className="r9-watch" {...watch}>
                    <AccessLink />
                  </span>
                  <div className="r9-hero-note a21-hero-rule">
                    <p className="rx-small">
                      Free during beta · Invite-only ·{" "}
                      <Link className="r9-signin" href="/sign-in">
                        Already invited? Sign in →
                      </Link>
                    </p>
                  </div>
                </>
              )}
              {access === "denied" && (
                <>
                  <AccessLink href="/sign-in">Manage sign-in</AccessLink>
                  <div className="r9-hero-note a21-hero-rule">
                    <p className="rx-small" role="status">
                      This account does not have access to Agent 21.
                    </p>
                  </div>
                </>
              )}
              {access === "unavailable" && (
                <div className="r9-hero-note a21-hero-rule">
                  <p className="rx-small" role="status">
                    {UNAVAILABLE}
                  </p>
                </div>
              )}
              {access === "soon" && (
                <p className="rx-small" role="status">
                  The website beta is coming soon.
                </p>
              )}
            </div>
          </div>
          <div className="r9-hero-art a21-hero-art">
            <AgentStage
              state={agentState}
              onHover={(over) => setFocus(over ? "agent" : null)}
              onPress={cheer}
            />
          </div>
        </section>
        <UseCases facts={facts} live={live} />
        <WhatItDoes />
        <div className="r9-beta section-divider">
          <div className="nx-wrap">
            <Beta access={access} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

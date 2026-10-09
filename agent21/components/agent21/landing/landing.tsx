"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentAvatar, type AgentState } from "../agent-avatar";
import { AccessLink, Beta, type Access } from "./parts";
import { SiteFooter, SiteHeader } from "./site-chrome";
import { UseCases } from "./use-cases";
import { WhatItDoes } from "./what-it-does";

const STATUS: Record<AgentState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  answering: "Answering",
  done: "Hello",
  asleep: "Resting",
};

function subscribeWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

// Agent 21 floats in a soft orange glow and reacts to the visitor.
function AgentStage({
  state,
  onHover,
  onPress,
}: {
  state: AgentState;
  onHover: (over: boolean) => void;
  onPress: () => void;
}) {
  const width = useSyncExternalStore(
    subscribeWidth,
    () => window.innerWidth,
    () => 1280,
  );
  const size =
    width <= 580 ? 200 : Math.round(Math.min(400, Math.max(230, width * 0.28)));
  return (
    <div className="r9-agent-stage">
      <div className="r9-agent-figure">
        <button
          type="button"
          className="r9-agent"
          aria-label="Say hello to Agent 21"
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
          onClick={onPress}
        >
          <AgentAvatar state={state} size={size} followPointer float />
        </button>
        <span className="r9-agent-floor" aria-hidden="true" />
        <p className="r9-agent-status" aria-live="polite">
          <i aria-hidden="true" />
          Agent 21 / {STATUS[state]}
        </p>
      </div>
    </div>
  );
}

// The Agent 21 landing page, shown to everyone without beta access.
export function Landing({ access }: { access: Access }) {
  // The hero agent reacts to what the visitor points at.
  const [focus, setFocus] = useState<"agent" | "access" | "explore" | null>(
    null,
  );
  const [cheering, setCheering] = useState(false);
  const cheerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(cheerTimer.current), []);
  const agentState: AgentState = cheering
    ? "done"
    : focus === "agent"
      ? "listening"
      : focus === "access"
        ? "done"
        : focus === "explore"
          ? "thinking"
          : "idle";
  const cheer = () => {
    clearTimeout(cheerTimer.current);
    setCheering(true);
    cheerTimer.current = setTimeout(() => setCheering(false), 1800);
  };
  const watch = (target: "access" | "explore") => ({
    onPointerEnter: () => setFocus(target),
    onPointerLeave: () => setFocus(null),
    onFocus: () => setFocus(target),
    onBlur: () => setFocus(null),
  });
  return (
    <div className="lp rx r9">
      <SiteHeader />
      <main>
        <section className="r9-hero">
          <div className="r9-hero-art r9-agent-art">
            <AgentStage
              state={agentState}
              onHover={(over) => setFocus(over ? "agent" : null)}
              onPress={cheer}
            />
          </div>
          <div className="r9-hero-copy">
            <span className="nx-status">
              INTRODUCING AGENT 21 · PRIVATE BETA
            </span>
            <h1>
              An AI agent for
              <br />
              <em>Bitcoin investing.</em>
            </h1>
            <p className="r9-lead">
              Bitcoin intelligence you can verify, now through conversation.
            </p>
            <p className="r9-intro">
              Agent 21 by Secret Satoshis brings original analysis, open data,
              and market frameworks into a conversation you can take further.
            </p>
            {access === "open" && (
              <>
                <span className="r9-watch" {...watch("access")}>
                  <AccessLink />
                </span>
                <p className="rx-small">
                  Free during beta · Invite-only access
                </p>
              </>
            )}
            {access === "denied" && (
              <>
                <AccessLink href="/sign-in">Manage sign-in</AccessLink>
                <p className="rx-small" role="status">
                  This account does not have access to Agent 21.
                </p>
              </>
            )}
            {access === "soon" && (
              <p className="rx-small" role="status">
                The website beta is coming soon.
              </p>
            )}
          </div>
          <div className="r9-hero-bottom">
            <span>Don&apos;t trust. Verify.</span>
            <a href="#use-cases" {...watch("explore")}>
              Explore the experience <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        <UseCases />
        <WhatItDoes />
        <div className="nx c5 r9-story">
          <div className="nx-wrap">
            <Beta access={access} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

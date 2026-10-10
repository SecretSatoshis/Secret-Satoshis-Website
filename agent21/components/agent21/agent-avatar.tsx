"use client";

import { useEffect, useRef } from "react";
// The face and its block are shared with the homepage hero, so both sites
// draw the same agent; they live at the website repo's root.
import {
  mountAgent,
  SMALL,
  type Agent,
  type AgentState,
} from "../../../js/agent21-face.js";
import "../../../css/agent21-face.css";

export { STATE_LABEL, type AgentState } from "../../../js/agent21-face.js";

export function AgentAvatar({
  state = "idle",
  size,
  followPointer = false,
  float = false,
}: {
  state?: AgentState;
  /** Width and height in CSS pixels. Without it the avatar takes its size
   * from a `--s` set in CSS, so the server renders it at its final size. */
  size?: number;
  /** Eyes (and, with `float`, the block) turn toward the cursor. */
  followPointer?: boolean;
  /** Gentle bob and tilt, for hero placements. */
  float?: boolean;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agent = useRef<Agent | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const mounted = mountAgent(root, canvas, {
      state: stateRef.current,
      size,
      followPointer,
      float,
    });
    agent.current = mounted;
    return () => {
      mounted.destroy();
      agent.current = null;
    };
  }, [size, followPointer, float]);

  useEffect(() => {
    stateRef.current = state;
    agent.current?.setState(state);
  }, [state]);

  return (
    <span
      ref={rootRef}
      className={
        size !== undefined && size < SMALL ? "a21-agent is-small" : "a21-agent"
      }
      style={
        size === undefined
          ? undefined
          : ({ "--s": `${size}px` } as React.CSSProperties)
      }
      aria-hidden="true"
    >
      <span className="a21-agent-shell" />
      <span className="a21-agent-screen">
        <canvas ref={canvasRef} />
      </span>
    </span>
  );
}

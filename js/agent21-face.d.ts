// Types for agent21-face.js, used by the Agent 21 app (TypeScript).
export type AgentState =
  | "idle"
  | "listening"
  | "thinking"
  | "answering"
  | "done";

export declare const SMALL: number;
export declare const STATE_LABEL: Record<AgentState, string>;

export type Agent = {
  setState(state: AgentState): void;
  destroy(): void;
};

export declare function mountAgent(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  options?: {
    state?: AgentState;
    /** Width and height in CSS pixels; without it, measured from `root`. */
    size?: number;
    followPointer?: boolean;
    float?: boolean;
  },
): Agent;

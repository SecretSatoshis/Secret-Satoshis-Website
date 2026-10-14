// The homepage hero: Agent 21, drawn by the face it shares with the Agent 21
// app, in place of the logo and linking to its site. It follows the cursor
// and listens while pointed at or focused. Its status line is just its name at
// rest and says it is ready while pointed at.
// The face's ?v= is its cache version: bump it with each change to the face,
// and this script's own ?v= in index.html with it.
import { mountAgent } from "./agent21-face.js?v=2";

const link = document.querySelector(".hero-agent");
const root = link?.querySelector(".a21-agent");
const canvas = root?.querySelector("canvas");
const status = document.querySelector(".hero-agent-state");
if (link && root && canvas) {
  const agent = mountAgent(root, canvas, { followPointer: true, float: true });
  const show = (state, label) => {
    agent.setState(state);
    if (status) status.textContent = label;
  };
  const listen = () => show("listening", "Agent 21 / Ready");
  const rest = () => show("idle", "Agent 21");
  link.addEventListener("pointerenter", listen);
  link.addEventListener("pointerleave", rest);
  link.addEventListener("focus", listen);
  link.addEventListener("blur", rest);
}

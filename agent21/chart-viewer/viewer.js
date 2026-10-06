// Receives one chart payload from the Agent 21 conversation that frames this
// page, places it where the Chart Library renderer reads it (#chart-data), then
// starts the renderer. Only a same-origin parent is accepted, and payload text
// is written with textContent, never parsed as HTML.
(() => {
  if (window.parent === window) return;
  const origin = window.location.origin;
  let started = false;
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element && typeof value === "string") element.textContent = value;
  };
  window.addEventListener("message", (event) => {
    if (started || event.origin !== origin || event.source !== window.parent)
      return;
    const message = event.data;
    if (message?.type !== "ss-chart-payload") return;
    const payload = message.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.title !== "string"
    )
      return;
    started = true;
    // The chart page fills these at build time; here they come from the payload.
    setText(
      "plot-label",
      Object.entries(payload.axes || {})
        .map(
          ([axis, details]) => `${axis.toUpperCase()}: ${details?.label ?? ""}`,
        )
        .join(" · "),
    );
    setText("reading-date", payload.dataDate || payload.reportDate);
    setText("chart-source", payload.source);
    setText("observation-note", payload.note);
    document
      .querySelector(".chart-card")
      ?.setAttribute("aria-label", payload.title);
    document
      .getElementById("chart")
      ?.setAttribute(
        "aria-label",
        `${payload.title}. Exact values and series controls are in the adjacent panel.`,
      );
    const data = document.createElement("script");
    data.type = "application/json";
    data.id = "chart-data";
    data.textContent = JSON.stringify(payload);
    document.body.append(data);
    const renderer = document.createElement("script");
    renderer.src = "assets/renderer.js";
    document.body.append(renderer);
  });
  window.parent.postMessage({ type: "ss-chart-ready" }, origin);
})();

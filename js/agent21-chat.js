// The homepage's Agent 21 example: Satoshi comes back and asks Agent 21 what
// Bitcoin has done since he left. Each reply follows the Agent 21 site's
// example chats (agent21/components/agent21/landing/use-cases.tsx): the
// agent's face and state, the step it ran, an answer revealed word by word,
// and a chart. The figures come from js/main.js (loaded first):
// loadSinceYouLeft() reads the Report Library's published candles,
// loadLivePrice() the price now and loadChain() the chain tip from BRK, each
// checked, with SATOSHI_LEFT_ON. The
// whole conversation is laid out at once, hidden, so nothing moves as it
// plays; it plays through once its first message scrolls into view, and the
// ask bar below it shows when it ends.
// The face's ?v= matches js/agent21-hero.js, so both load one copy.
import { mountAgent, SMALL, STATE_LABEL } from "./agent21-face.js?v=2";

const WORD_MS = 28; // between words; keep in step with .chat-w in css/style.css
const BLOCK_WORDS = 10; // a chart counts as this many words
const THINK_MS = 1100;
const PAUSE_MS = 700;
const AVATAR = 40;
const REPORT_LIBRARY = "https://secretsatoshis.github.io/Bitcoin-Report-Library/";
const BRK = "https://bitview.space/";

const SVG_NS = "http://www.w3.org/2000/svg";
// Phones draw on a narrower canvas, so the charts' 10-unit labels stay legible
// once scaled to the screen.
const VIEW = { w: window.matchMedia("(max-width: 580px)").matches ? 360 : 600, h: 236 };
const PLOT = { x0: 44, x1: VIEW.w - 10, y0: 212, y1: 12 };
const COLOR = { price: "#f7931a", axis: "#82829c", grid: "#1c1c2e", well: "#060610", text: "#e4e4ef", empty: "#13131d", edge: "#2a2a42" };

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Words and numbers ─────────────────────────────────────────────

const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const format = (iso, options) => utc(iso).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
/** "Oct 8, 2026" */
const shortDate = (iso) => format(iso, { month: "short", day: "numeric", year: "numeric" });
/** "October 8, 2026" */
const longDate = (iso) => format(iso, { month: "long", day: "numeric", year: "numeric" });
const count = (n) => n.toLocaleString("en-US");
/** The visitor's date, as "2026-10-09". */
const today = () => new Date().toLocaleDateString("en-CA");
/** "Oct 10, 2026, 00:06 UTC" */
const retrieved = (stamp) => `${shortDate(stamp.slice(0, 10))}, ${stamp.slice(11, 16)} UTC`;
/** "20,095,896": whole bitcoin. */
const btc = (n) => count(Math.round(n));
/** "$0.21", "$81,650" */
const usd = (n) => (n < 10 ? `$${n.toFixed(2)}` : `$${count(Math.round(n))}`);
/** "52,700x" (three figures), "1.43x" */
const times = (n) => `${n >= 100 ? n.toLocaleString("en-US", { maximumSignificantDigits: 3 }) : n.toFixed(n < 10 ? 2 : 1)}x`;
/** "$100k", "$60k", "$1", "$0.1" */
const tickLabel = (v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`);
const b = (text) => ({ b: text });

// The conversation. Every figure comes from the published candles, the price
// now and the chain tip; an answer whose source is unavailable says so or is
// left out, and without the price now it quotes the latest close.
function conversation(f, chain) {
  const days = Math.round((utc(today()) - utc(SATOSHI_LEFT_ON)) / 86400000);
  const messages = [
    { from: "agent", rest: "idle", answer: [["Hello, I'm Agent 21. What can I look into for you?"]] },
    { from: "user", text: "Hey Agent 21. What's happened to the Bitcoin price since I left?" },
  ];
  if (f) {
    messages.push({
      from: "agent",
      think: true,
      step: f.live
        ? `Read ${count(f.history.length - 1)} weekly candles from the Report Library and the price now from BRK`
        : `Read ${count(f.history.length)} weekly candles from the Report Library`,
      answer: [
        [
          "Welcome back. It's been ", b(`${count(days)} days`), " since your last email. Bitcoin closed at ",
          b(usd(f.leftClose)), " that day and ", ...(f.live
            ? ["is at ", b(usd(f.close)), " today. You're up about "]
            : [b(usd(f.close)), ` on ${longDate(f.reportDate)}. You're up about `]),
          b(times(f.close / f.leftClose)), ". Looks like you were on to something.",
        ],
        () => historyChart(f),
      ],
      source: [
        { label: "Report Library", href: REPORT_LIBRARY },
        `Weekly closes through ${shortDate(f.reportDate)}`,
        ...(f.live ? [{ label: "BRK", href: BRK }, `Price · ${retrieved(new Date(f.live.at).toISOString())}`] : []),
      ],
    });
  } else {
    messages.push({
      from: "agent",
      think: true,
      answer: [[
        "Welcome back. It's been ", b(`${count(days)} days`), " since your last email. ",
        "I can't reach the market data right now.",
      ]],
    });
  }
  if (chain) {
    const toGo = chain.nextHalving - chain.height;
    // Ten minutes a block, in months while there are two or more.
    const months = Math.round((toGo * 10) / (60 * 24 * 30.44));
    const eta = months >= 2 ? `${months} months` : `${Math.round((toGo * 10) / (60 * 24))} days`;
    messages.push(
      { from: "user", text: "And the supply? What block are we at?" },
      {
        from: "agent",
        think: true,
        step: "Read the chain tip from BRK",
        answer: [
          [
            "We're at block ", b(count(chain.height)), ". ", b(`${btc(chain.mined)} BTC`), " have been mined, ",
            b(`${(chain.share * 100).toFixed(1)}%`), ` of the 21 million, up from ${btc(chain.minedWhenLeft)} when you left. `,
            "Each block pays ", b(`${chain.subsidy} BTC`), ` until the halving at block ${count(chain.nextHalving)}, about ${eta} away.`,
          ],
          () => supplyChart(chain),
        ],
        source: [
          { label: "BRK", href: BRK },
          [`Block ${count(chain.height)}`, chain.retrievedAt && retrieved(chain.retrievedAt)].filter(Boolean).join(" · "),
        ],
      },
    );
  }
  messages.push(
    { from: "user", text: "Good to see it's still running. And what are you? There was no AI like you when I left." },
    {
      from: "agent",
      think: true,
      answer: [[
        "I'm Agent 21, the Bitcoin-native AI agent built by Secret Satoshis. I work from their research, data and ",
        "market frameworks. What would you like to look at next?",
      ]],
    },
  );
  return messages;
}

// ── Messages ──────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Splits text into word spans numbered in reading order (--i), so CSS can
// reveal them in sequence without the layout moving.
function words(parent, text, counter) {
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      parent.append(part);
      continue;
    }
    const word = el("span", "chat-w", part);
    word.style.setProperty("--i", counter.n++);
    parent.append(word);
  }
}

function paragraph(segments, counter) {
  const p = el("p");
  for (const segment of segments) {
    if (typeof segment === "string") {
      words(p, segment, counter);
    } else {
      const strong = el("strong");
      words(strong, segment.b, counter);
      p.append(strong);
    }
  }
  return p;
}

function userMessage({ text }) {
  const node = el("div", "chat-user");
  node.append(el("span", "chat-user-name", "Satoshi"), el("p", undefined, text));
  return { node };
}

function agentMessage({ step, answer, source, think = false, rest = "done" }) {
  const node = el("div", "chat-msg");
  const face = el("span", AVATAR < SMALL ? "a21-agent is-small" : "a21-agent");
  face.setAttribute("aria-hidden", "true");
  face.style.setProperty("--s", `${AVATAR}px`);
  const screen = el("span", "a21-agent-screen");
  const canvas = el("canvas");
  screen.append(canvas);
  face.append(el("span", "a21-agent-shell"), screen);

  const body = el("div", "chat-msg-body");
  const name = el("div", "chat-name", "Agent 21 ");
  const chip = el("span", "chat-chip", STATE_LABEL.idle);
  name.append(chip);
  body.append(name);
  if (step) body.append(el("p", "chat-step", step));

  const text = el("div", "chat-answer");
  const counter = { n: 0 };
  for (const part of answer) {
    if (typeof part === "function") {
      const block = el("div", "chat-block");
      block.style.setProperty("--i", counter.n);
      counter.n += BLOCK_WORDS;
      block.append(part());
      text.append(block);
    } else {
      text.append(paragraph(part, counter));
    }
  }
  body.append(text);

  // The source: links (label and href) and notes, in order.
  if (source) {
    const line = el("p", "chat-source");
    line.append(el("span", undefined, "↳"));
    line.firstChild.setAttribute("aria-hidden", "true");
    for (const part of source) {
      if (typeof part === "string") {
        line.append(el("span", undefined, part));
      } else {
        const link = el("a", undefined, `${part.label} ↗`);
        link.href = part.href;
        line.append(link);
      }
    }
    body.append(line);
  }
  node.append(face, body);
  return { node, face, canvas, chip, words: counter.n, think, rest };
}

// Resolves once `node` is in the top four-fifths of the screen, or has been
// scrolled past.
function reached(node) {
  return new Promise((resolve) => {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
        io.disconnect();
        resolve();
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(node);
  });
}

// Plays the messages in turn once the first comes into view: a reply thinks
// (with its step showing), writes its answer word by word, then shows its
// source.
// finish() shows everything at once in its final state. Either way `done`
// runs once the last message is in.
function player(messages, done) {
  let stopped = false;
  const set = (message, state, phase) => {
    message.agent ??= mountAgent(message.face, message.canvas, { size: AVATAR, state });
    message.agent.setState(state);
    message.chip.textContent = STATE_LABEL[state];
    message.node.dataset.phase = phase;
  };
  async function play() {
    await reached(messages[0].node);
    for (const message of messages) {
      if (stopped) return;
      if (!message.face) {
        message.node.dataset.phase = "done";
      } else {
        if (message.think) {
          set(message, "thinking", "thinking");
          await wait(THINK_MS);
          if (stopped) return;
        }
        set(message, "answering", "answering");
        await wait(message.words * WORD_MS + 400);
        if (stopped) return;
        set(message, message.rest, "done");
      }
      if (message !== messages[messages.length - 1]) await wait(PAUSE_MS);
    }
    done();
  }
  function finish() {
    if (stopped) return;
    stopped = true;
    for (const message of messages) {
      if (message.face) set(message, message.rest, "done");
      else message.node.dataset.phase = "done";
    }
    done();
  }
  return { play, finish };
}

// ── Charts ────────────────────────────────────────────────────────

function svg(tag, attributes, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

function logScale(lo, hi) {
  const [from, to] = [Math.log(lo), Math.log(hi)];
  return (v) => PLOT.y0 - ((Math.log(v) - from) / (to - from)) * (PLOT.y0 - PLOT.y1);
}

function frame(title, range, label, height = VIEW.h) {
  const figure = el("figure", "chat-chart");
  const caption = el("figcaption", "chat-chart-t");
  caption.append(el("span", undefined, title), el("span", undefined, range));
  const plot = el("div", "chat-plot");
  const root = svg("svg", { viewBox: `0 0 ${VIEW.w} ${height}`, role: "img", "aria-label": label, tabindex: "0" });
  plot.append(root);
  figure.append(caption, plot);
  return { figure, plot, root };
}

function axes(root, y, ticks, labels) {
  const grid = svg("g", { stroke: COLOR.grid }, root);
  const text = svg("g", { fill: COLOR.axis, "font-size": "10" }, root);
  for (const t of ticks) {
    svg("line", { x1: PLOT.x0, x2: PLOT.x1, y1: y(t), y2: y(t) }, grid);
    svg("text", { x: 38, y: y(t) + 3, "text-anchor": "end" }, text).textContent = tickLabel(t);
  }
  for (const [x, label] of labels) {
    svg("text", { x, y: 230, "text-anchor": "middle" }, text).textContent = label;
  }
}

const halo = { stroke: COLOR.well, "stroke-width": 4, "stroke-linejoin": "round", "paint-order": "stroke" };

// The point under the pointer, by its x position: the nearest of `xs`, or
// whatever `pick` finds there. A mouse picks it on hover; touch picks it on a
// tap, never as a scroll starts, and a tap elsewhere puts it away; the arrow
// keys step through it, and only those steps are spoken. The readout sits at
// the point's x.
function explore(root, plot, { xs, readout, mark, pick = (at) => nearest(xs, at) }) {
  const tip = el("div", "chat-tip");
  tip.hidden = true;
  const spoken = el("p", "chat-sr");
  spoken.setAttribute("aria-live", "polite");
  plot.append(tip, spoken);
  let point = null;

  const show = (i, keyed = false) => {
    point = i;
    const { title, rows } = readout(i);
    tip.replaceChildren(
      el("b", undefined, title),
      ...rows.map(([label, value, color]) => {
        const row = el("div");
        if (color) {
          const swatch = el("i");
          swatch.style.background = color;
          row.append(swatch);
        }
        row.append(label, el("span", undefined, value));
        return row;
      }),
    );
    tip.dataset.side = xs[i] > VIEW.w / 2 ? "left" : "right";
    tip.style.left = `${(xs[i] / VIEW.w) * 100}%`;
    tip.hidden = false;
    spoken.textContent = keyed ? `${title}: ${rows.map(([label, value]) => `${label} ${value}`).join(", ")}` : "";
    mark(i);
  };
  const hide = () => {
    point = null;
    tip.hidden = true;
    spoken.textContent = "";
    mark(null);
  };
  const under = (e) => {
    const box = root.getBoundingClientRect();
    return pick(((e.clientX - box.left) / box.width) * VIEW.w);
  };

  root.addEventListener("pointerdown", (e) => e.pointerType !== "touch" && show(under(e)));
  root.addEventListener("pointerup", (e) => e.pointerType === "touch" && show(under(e)));
  root.addEventListener("pointermove", (e) => (e.pointerType !== "touch" || point !== null) && show(under(e)));
  root.addEventListener("pointerleave", (e) => e.pointerType !== "touch" && hide());
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    show(Math.min(xs.length - 1, Math.max(0, (point ?? xs.length) + step)), true);
  });
  document.addEventListener("pointerdown", (e) => {
    if (point !== null && !root.contains(e.target)) hide();
  });
}

function nearest(xs, at) {
  let best = 0;
  xs.forEach((x, i) => {
    if (Math.abs(x - at) < Math.abs(xs[best] - at)) best = i;
  });
  return best;
}

// Every weekly close since August 2010 on a log scale, then the price now
// when there is one, with a line at the day Satoshi left.
function historyChart(f) {
  const weeks = f.history;
  const first = weeks[0].start;
  const last = weeks[weeks.length - 1].start;
  const { figure, plot, root } = frame(
    "Bitcoin price since 2010",
    `Weekly close · ${shortDate(first)} – ${shortDate(f.asOf)} · USD, log scale`,
    `Bitcoin's weekly close on a log scale from ${longDate(first)} to ${longDate(f.asOf)}, ` +
      `rising from ${usd(f.leftClose)} on ${longDate(f.leftOn)}, the day of Satoshi's last known email, to ${usd(f.close)}`,
  );
  const closes = weeks.map((w) => w.close);
  const [lo, hi] = [Math.min(...closes) * 0.7, Math.max(...closes) * 1.4];
  const y = logScale(lo, hi);
  const [t0, t1] = [utc(first).getTime(), utc(last).getTime()];
  const x = (iso) => PLOT.x0 + ((utc(iso).getTime() - t0) / (t1 - t0)) * (PLOT.x1 - PLOT.x0);
  const decades = [];
  for (let v = 10 ** Math.ceil(Math.log10(lo)); v < hi; v *= 10) decades.push(Number(v.toPrecision(1)));
  const years = [];
  for (let year = utc(first).getUTCFullYear() + 1; year <= utc(last).getUTCFullYear(); year++) {
    if (year % 2 === 0) years.push([x(`${year}-01-01`), String(year)]);
  }
  axes(root, y, decades, years);

  const xs = weeks.map((w) => x(w.start));
  svg("polyline", {
    fill: "none",
    stroke: COLOR.price,
    "stroke-width": 1.6,
    "stroke-linejoin": "round",
    points: weeks.map((w, i) => `${xs[i].toFixed(1)},${y(w.close).toFixed(1)}`).join(" "),
  }, root);

  const left = x(f.leftOn);
  svg("line", { x1: left, x2: left, y1: PLOT.y1, y2: PLOT.y0, stroke: COLOR.text, "stroke-opacity": 0.55, "stroke-dasharray": "4 4" }, root);
  svg("circle", { cx: left, cy: y(f.leftClose), r: 3.5, fill: COLOR.text, stroke: COLOR.well, "stroke-width": 1.5 }, root);
  svg("text", { x: left + 7, y: PLOT.y1 + 10, fill: COLOR.text, "font-size": "10", ...halo }, root).textContent =
    `You left · ${shortDate(f.leftOn)}`;
  svg("circle", { cx: xs[xs.length - 1], cy: y(f.close), r: 3.5, fill: COLOR.price, stroke: COLOR.well, "stroke-width": 1.5 }, root);

  const cross = svg("g", { class: "chat-cross" }, root);
  cross.style.display = "none";
  const crossLine = svg("line", { y1: PLOT.y1, y2: PLOT.y0 }, cross);
  const crossDot = svg("circle", { r: 3.5, fill: COLOR.price }, cross);
  explore(root, plot, {
    xs,
    readout: (i) => {
      const w = weeks[i];
      const rows = [[w.now ? "Price" : "Close", usd(w.close), COLOR.price]];
      if (w.start >= f.leftOn) rows.push(["Since you left", times(w.close / f.leftClose)]);
      return { title: w.now ? `Now · ${shortDate(w.start)}` : `Week of ${shortDate(w.start)}`, rows };
    },
    mark: (i) => {
      cross.style.display = i === null ? "none" : "";
      if (i === null) return;
      for (const [key, value] of [["x1", xs[i]], ["x2", xs[i]]]) crossLine.setAttribute(key, value);
      crossDot.setAttribute("cx", xs[i]);
      crossDot.setAttribute("cy", y(weeks[i].close));
    },
  });
  return figure;
}

// The 21 million as one bar: mined in orange, the rest still to mine, split
// at each halving, with marks where the total stood when Satoshi left and
// where it stands now. Each era shows its blocks, reward and bitcoin.
function supplyChart(chain) {
  const { eras, mined, minedWhenLeft } = chain;
  const total = eras[eras.length - 1].end;
  const share = (n) => `${((n / total) * 100).toFixed(1)}%`;
  const H = 92;
  const bar = { x0: 10, x1: VIEW.w - 10, y: 36, h: 30 };
  const x = (n) => bar.x0 + (n / total) * (bar.x1 - bar.x0);
  const { figure, plot, root } = frame(
    "Bitcoin's 21 million",
    `Mined through block ${count(chain.height)} · split at each halving`,
    `${btc(mined)} of 21 million bitcoin mined through block ${count(chain.height)}, ${share(mined)}, ` +
      `with ${btc(chain.left)} left to mine; ${btc(minedWhenLeft)} had been mined when Satoshi left`,
    H,
  );
  svg("rect", { x: bar.x0, y: bar.y, width: bar.x1 - bar.x0, height: bar.h, rx: 3, fill: COLOR.empty, stroke: COLOR.edge }, root);
  svg("rect", { x: bar.x0, y: bar.y, width: x(mined) - bar.x0, height: bar.h, rx: 3, fill: COLOR.price }, root);
  const era = svg("rect", { class: "chat-week", y: bar.y, height: bar.h });
  era.style.display = "none";
  root.append(era);
  const lines = svg("g", { stroke: COLOR.well, "stroke-width": 1.5 }, root);
  for (const { end } of eras.slice(0, -1)) svg("line", { x1: x(end), x2: x(end), y1: bar.y, y2: bar.y + bar.h }, lines);

  const labels = svg("g", { "font-size": "10" }, root);
  for (const [at, text, anchor, color] of [
    [minedWhenLeft, `You left · ${btc(minedWhenLeft)}`, "start", COLOR.text],
    [mined, `Now · ${share(mined)}`, "end", COLOR.price],
  ]) {
    svg("line", { x1: x(at), x2: x(at), y1: bar.y - 14, y2: bar.y + bar.h, stroke: color, "stroke-dasharray": "3 3" }, root);
    svg("text", { x: x(at) + (anchor === "start" ? 5 : -5), y: bar.y - 6, "text-anchor": anchor, fill: color, ...halo }, labels).textContent = text;
  }
  svg("text", { x: bar.x0, y: bar.y + bar.h + 18, fill: COLOR.axis }, labels).textContent = `${btc(mined)} mined`;
  svg("text", { x: bar.x1, y: bar.y + bar.h + 18, "text-anchor": "end", fill: COLOR.axis }, labels).textContent = `${btc(chain.left)} left`;

  const starts = eras.map((_, i) => (i ? eras[i - 1].end : 0));
  explore(root, plot, {
    xs: eras.map(({ end }, i) => (x(starts[i]) + x(end)) / 2),
    pick: (at) => {
      const i = eras.findIndex(({ end }) => at < x(end));
      return i === -1 ? eras.length - 1 : i;
    },
    readout: (i) => {
      const e = eras[i];
      const done = Math.min(1, Math.max(0, (mined - starts[i]) / e.issued));
      return {
        title: e.last === null ? `Blocks ${count(e.first)} onward` : `Blocks ${count(e.first)}–${count(e.last)}`,
        rows: [
          ["Reward", `${e.subsidy} BTC${e.last === null ? ", then halving" : ""}`],
          ["Issues", `${btc(e.issued)} BTC`],
          ["Mined", `${Math.round(done * 100)}%`, done > 0 ? COLOR.price : undefined],
        ],
      };
    },
    mark: (i) => {
      era.style.display = i === null ? "none" : "";
      if (i === null) return;
      era.setAttribute("x", x(starts[i]));
      era.setAttribute("width", x(eras[i].end) - x(starts[i]));
    },
  });
  return figure;
}

// ── Start ─────────────────────────────────────────────────────────

async function start(chat, log, date) {
  const [candles, chain, livePrice] = await Promise.all([loadSinceYouLeft(), loadChain(), loadLivePrice()]);
  const facts = candles && withLivePrice(candles, livePrice);
  date.textContent = shortDate(facts ? facts.asOf : today());
  const messages = conversation(facts, chain).map((m) => (m.from === "user" ? userMessage(m) : agentMessage(m)));
  for (const message of messages) {
    message.node.dataset.phase = "waiting";
    log.append(message.node);
  }
  chat.setAttribute("aria-busy", "false");
  // Agent 21's last question hands over to the ask bar below the conversation.
  const { play, finish } = player(messages, () => chat.classList.add("is-done"));
  // Focus inside (a chart, a link) before the conversation has played shows it
  // whole, so focus never lands on something hidden.
  chat.addEventListener("focusin", finish);
  if (reduced) finish();
  else play();
}

const chat = document.getElementById("agentChat");
const log = document.getElementById("agentChatLog");
const date = document.getElementById("agentChatDate");
if (chat && log && date) {
  // The ask bar waits for the conversation (see .chat-ask in css/style.css).
  chat.classList.add("is-playing");
  // Load the data a screen before the chat comes into view.
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      start(chat, log, date);
    },
    { rootMargin: "100% 0px" },
  );
  near.observe(chat);
}

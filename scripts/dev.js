/**
 * Local dev orchestrator: preflight checks, then the service panels.
 *
 * The site is two processes — the Hono API (server/, tsx watch) and the Vite dev
 * server (client/) — and Vite proxies /api to the API, so the API has to be up
 * for the site to be useful. Running them under one TUI keeps both log streams
 * readable and, more importantly, makes shutdown total: `tsx watch` and Vite
 * both spawn children that survive a plain SIGINT on Windows, so cleanup kills
 * the whole process tree.
 *
 * Preflight fails fast on the things that produce confusing runtime errors
 * instead of startup errors: a missing GITHUB_USERNAME (the API throws on
 * import), un-installed workspaces, and an occupied :5173 (Vite runs with
 * strictPort, so a stale dev server means the new one dies immediately) or
 * :3000 (a stale API keeps serving the proxy with old code).
 */

import { exec, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import * as p from "@clack/prompts";
import termkit from "terminal-kit";

const term = termkit.terminal;
const execAsync = promisify(exec);
const isWindows = process.platform === "win32";
const root = resolve(import.meta.dirname, "..");

const BANNER = String.raw`
  _   _  ___  ___  _____  ___  __  __     _    _____  _____
 | | | ||_ _||_ _||_   _|/ __||  \/  |   /_\  |_   _||_   _|
 | |_| | | |  | |   | |  \__ \| |\/| |  / _ \   | |    | |
 |_| |_||___||___|  |_|  |___/|_|  |_| /_/ \_\  |_|    |_|
`;

const WEB_PORT = 5173; // client/vite.config.ts — strictPort, so this one is load-bearing

/** `KEY=value` pairs from server/.env, which is the only env file in the repo. */
function readServerEnv() {
  const envPath = resolve(root, "server", ".env");
  if (!existsSync(envPath)) return {};

  const env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=][^=]*)=(.*)/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/**
 * Vite binds `localhost`, which on Windows is ::1 first, while the API binds
 * 0.0.0.0 — so a single-family connect test misses half of the stale servers
 * this is meant to find. netstat/lsof is the reliable answer (and yields the
 * PID to kill); the connect probes are the fallback when it is unavailable.
 */
async function probePort(port) {
  const pids = await listenerPids(port);
  if (pids.length > 0) return { inUse: true, pids };

  const [v4, v6] = await Promise.all([canConnect("127.0.0.1", port), canConnect("::1", port)]);
  return { inUse: v4 || v6, pids: [] };
}

function canConnect(host, port) {
  return new Promise((res) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      res(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      res(false);
    });
    socket.on("error", () => res(false));
  });
}

/**
 * Local address is IPv4 (`127.0.0.1:5173`) or IPv6 (`[::1]:5173`); the port is
 * whatever follows the last colon either way. PID 0 is the idle process, which
 * owns the TIME_WAIT leftovers.
 */
function parseNetstatPids(stdout, port) {
  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m && Number(m[1]) === port && m[2] !== "0") pids.add(m[2]);
  }
  return [...pids];
}

// Bare `netstat -ano`, not `-p tcp`: the protocol filter is IPv4-only, and
// Vite's listener lives on [::1].
const LISTENERS_CMD = isWindows ? "netstat -ano" : null;
const listenersCmdUnix = (port) => `lsof -ti tcp:${port} -sTCP:LISTEN`;

/** PIDs listening on `port`, so a stale dev server can be cleared without hunting for it. */
async function listenerPids(port) {
  try {
    if (!isWindows) {
      const { stdout } = await execAsync(listenersCmdUnix(port));
      return [...new Set(stdout.split(/\s+/).filter(Boolean))];
    }
    const { stdout } = await execAsync(LISTENERS_CMD);
    return parseNetstatPids(stdout, port);
  } catch {
    return [];
  }
}

/** Same lookup, usable from an exit handler where nothing async will ever run again. */
function listenerPidsSync(port) {
  try {
    if (!isWindows) {
      const stdout = execSync(listenersCmdUnix(port), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return [...new Set(stdout.split(/\s+/).filter(Boolean))];
    }
    const stdout = execSync(LISTENERS_CMD, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parseNetstatPids(stdout, port);
  } catch {
    return [];
  }
}

function killPid(pid, { sync = false } = {}) {
  const cmd = isWindows ? `taskkill /f /t /pid ${pid}` : `kill -9 ${pid}`;
  if (sync) {
    try {
      execSync(cmd, { stdio: "ignore", shell: true });
    } catch {}
    return Promise.resolve();
  }
  return execAsync(cmd).catch(() => {});
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** A kill takes a moment to release the socket, and the exit path has no event loop left. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function startup() {
  console.log(BANNER);
  p.intro("Local Dev Environment");

  const s = p.spinner();
  const env = readServerEnv();

  const githubUsername = env.GITHUB_USERNAME || process.env.GITHUB_USERNAME;
  if (!githubUsername) {
    p.log.error("GITHUB_USERNAME is not set in server/.env");
    p.log.warn("Copy server/.env.example to server/.env and fill it in.");
    process.exit(1);
  }
  p.log.success(`GitHub owner: ${githubUsername}`);

  if (!(env.GITHUB_TOKEN || process.env.GITHUB_TOKEN)) {
    p.log.warn("GITHUB_TOKEN is not set: 60 requests/hour and no contributions graph");
  }

  const apiPort = Number(env.PORT) || 3000;

  // Workspaces are hoisted, but a missing client/server link means npm never ran here.
  const missingDeps = ["node_modules", "client/node_modules", "server/node_modules"].filter(
    (dir) => !existsSync(resolve(root, dir)),
  );
  if (missingDeps.length > 0) {
    s.start("Installing dependencies...");
    try {
      await execAsync("npm install", { cwd: root, timeout: 300000 });
      s.stop("Dependencies installed");
    } catch {
      s.stop("npm install failed");
      p.log.warn("Run it manually: npm install");
      process.exit(1);
    }
  } else {
    p.log.success("Dependencies installed");
  }

  for (const [port, label] of [
    [apiPort, "API"],
    [WEB_PORT, "Webapp"],
  ]) {
    const { inUse, pids } = await probePort(port);
    if (!inUse) continue;

    if (pids.length === 0) {
      p.log.warn(`Port ${port} (${label}) is in use by an unidentified process — ${label} will fail to start`);
      continue;
    }

    const shouldKill = await p.confirm({
      message: `Port ${port} (${label}) is in use by PID ${pids.join(", ")}. Kill it?`,
      initialValue: true,
    });

    if (p.isCancel(shouldKill) || !shouldKill) {
      p.log.warn(`Leaving port ${port} alone — ${label} will fail to start`);
      continue;
    }

    s.start(`Freeing port ${port}...`);
    await Promise.all(pids.map((pid) => killPid(pid)));

    let stillInUse = true;
    for (let attempt = 0; attempt < 10; attempt++) {
      stillInUse = (await probePort(port)).inUse;
      if (!stillInUse) break;
      await delay(300);
    }
    s.stop(stillInUse ? `Port ${port} is still in use` : `Port ${port} is free`);
  }

  p.outro("Launching services...");
  return { apiPort };
}

function launchUI({ apiPort }) {
  const panels = [
    {
      name: ` Webapp :${WEB_PORT} `,
      color: "cyan",
      cmd: "npm",
      args: ["-w", "client", "run", "dev"],
    },
    {
      name: ` API :${apiPort} `,
      color: "magenta",
      cmd: "npm",
      args: ["-w", "server", "run", "dev"],
    },
  ];

  const buffers = panels.map(() => []);
  const scrollOffsets = panels.map(() => 0);
  let focusedPanel = 0;

  // Recomputed on resize: the panels are laid out from the live terminal size,
  // and a redraw with stale geometry leaves torn borders behind.
  let panelHeight = 0;
  let geometry = [];

  function layout() {
    panelHeight = term.height - 1; // status bar
    const half = Math.floor(term.width / 2);
    geometry = [
      { x: 1, w: half },
      { x: half + 1, w: term.width - half },
    ];
  }

  function stripAnsi(str) {
    // \x1b[…m is what an ANSI colour sequence looks like; panel width has to be
    // measured on the visible characters only.
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  function drawBorder(x, y, w, h, label, color) {
    const colorFn = term[color] || term.white;

    colorFn.moveTo(x, y, `╭${"─".repeat(w - 2)}╮`);
    for (let row = 1; row < h - 1; row++) {
      colorFn.moveTo(x, y + row, "│");
      colorFn.moveTo(x + w - 1, y + row, "│");
    }
    colorFn.moveTo(x, y + h - 1, `╰${"─".repeat(w - 2)}╯`);

    if (label) colorFn.bold.moveTo(x + 2, y, label);
  }

  function drawPanel(panelIndex) {
    const { x, w } = geometry[panelIndex];
    const y = 1;
    const h = panelHeight;
    const contentHeight = h - 2;
    const contentWidth = w - 4;

    const panel = panels[panelIndex];
    const buf = buffers[panelIndex];
    const offset = scrollOffsets[panelIndex];

    drawBorder(x, y, w, h, panel.name, panel.color);

    const visibleLines = buf.slice(offset, offset + contentHeight);
    for (let i = 0; i < contentHeight; i++) {
      term.moveTo(x + 2, y + 1 + i);
      if (i < visibleLines.length) {
        const line = visibleLines[i].substring(0, contentWidth);
        term.noFormat(line + " ".repeat(Math.max(0, contentWidth - stripAnsi(line).length)));
      } else {
        term(" ".repeat(contentWidth));
      }
    }

    // Scrollbar
    if (buf.length > contentHeight) {
      const scrollbarHeight = Math.max(1, Math.floor((contentHeight * contentHeight) / buf.length));
      const scrollbarPos = Math.floor(
        (offset / Math.max(1, buf.length - contentHeight)) * (contentHeight - scrollbarHeight),
      );
      for (let i = 0; i < contentHeight; i++) {
        term.moveTo(x + w - 2, y + 1 + i);
        if (i >= scrollbarPos && i < scrollbarPos + scrollbarHeight) {
          term[panel.color]("█");
        } else {
          term.dim("░");
        }
      }
    }

    // Focus indicator
    if (panelIndex === focusedPanel) {
      term[panel.color].bold.moveTo(x, y + h - 1, "╰─►");
    }
  }

  function appendOutput(panelIndex, text) {
    const newLines = text.split("\n");
    buffers[panelIndex].push(...newLines);

    const contentHeight = panelHeight - 2;
    const buf = buffers[panelIndex];
    if (scrollOffsets[panelIndex] >= buf.length - contentHeight - newLines.length) {
      scrollOffsets[panelIndex] = Math.max(0, buf.length - contentHeight);
    }

    drawPanel(panelIndex);
  }

  function scroll(panelIndex, direction) {
    const contentHeight = panelHeight - 2;
    const maxOffset = Math.max(0, buffers[panelIndex].length - contentHeight);
    scrollOffsets[panelIndex] = Math.min(maxOffset, Math.max(0, scrollOffsets[panelIndex] + direction));
    drawPanel(panelIndex);
  }

  function drawStatusBar() {
    const y = term.height;
    term.moveTo(1, y);
    term.eraseLine();
    term.moveTo(1, y);
    term.white.dim(" j/k/↑/↓ ");
    term.white("scroll  ");
    term.white.dim("Tab ");
    term.white("switch  ");
    term.white.dim("PgUp/PgDn ");
    term.white("page  ");
    term.white.dim("c ");
    term.white("copy  ");
    term.white.dim("Esc ");
    term.white("quit");
  }

  function redrawAll() {
    layout();
    term.clear();
    panels.forEach((_, i) => {
      drawPanel(i);
    });
    drawStatusBar();
  }

  term.hideCursor();
  redrawAll();

  // Whatever is already listening now is not ours: preflight offered to kill it
  // and was declined, so shutdown must leave it alone.
  const foreignPids = new Set([...listenerPidsSync(apiPort), ...listenerPidsSync(WEB_PORT)]);

  const procs = panels.map((panel, i) => {
    const proc = spawn(panel.cmd, panel.args, {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    const append = (data) => {
      const text = data.toString().replace(/\r\n/g, "\n").replace(/\r/g, "").trimEnd();
      if (text) appendOutput(i, text);
    };

    proc.stdout.on("data", append);
    proc.stderr.on("data", append);
    proc.on("exit", (code) => {
      appendOutput(i, `[Process exited with code ${code}]`);
    });

    return proc;
  });

  // Input handling (no mouse grab so terminal text selection/copy works natively)
  term.grabInput(true);

  term.on("key", (key) => {
    if (key === "ESCAPE" || key === "q" || key === "CTRL_C") {
      cleanup({ reason: key });
    } else if (key === "c") {
      const text = buffers[focusedPanel].map((l) => stripAnsi(l)).join("\n");
      const clip = spawn(isWindows ? "clip.exe" : "pbcopy", [], { shell: true });
      clip.on("error", () => {});
      clip.stdin.end(text);
    } else if (key === "TAB") {
      focusedPanel = (focusedPanel + 1) % panels.length;
      panels.forEach((_, i) => {
        drawPanel(i);
      });
    } else if (key === "UP" || key === "k") {
      scroll(focusedPanel, -1);
    } else if (key === "DOWN" || key === "j") {
      scroll(focusedPanel, 1);
    } else if (key === "PAGE_UP") {
      scroll(focusedPanel, -(panelHeight - 4));
    } else if (key === "PAGE_DOWN") {
      scroll(focusedPanel, panelHeight - 4);
    }
  });

  term.on("resize", () => {
    redrawAll();
  });

  let cleanedUp = false;

  /**
   * `taskkill /t` walks live parent links, and npm reaches the dev server
   * through cmd.exe and then bash.exe (`script-shell`); as soon as one of those
   * intermediates has exited, the walk stops short of Vite/tsx and the port
   * stays held by a process whose console is already gone. Killing the panel
   * trees is therefore only the first pass — the authoritative pass is "kill
   * whatever is listening on our ports and was not listening before we started".
   */
  function cleanup({ exit = true, reason = "quit" } = {}) {
    if (cleanedUp) return;
    cleanedUp = true;

    term.grabInput(false);
    term.hideCursor(false);
    term.clear();
    term.moveTo(1, 1);
    term(`Stopping dev services (${reason})...\n`);

    for (const proc of procs) {
      killPid(proc.pid, { sync: true });
    }

    const ourStrays = () =>
      new Set([apiPort, WEB_PORT].flatMap((port) => listenerPidsSync(port)).filter((pid) => !foreignPids.has(pid)));

    for (let pass = 0; pass < 3; pass++) {
      const strays = ourStrays();
      if (strays.size === 0) break;
      for (const pid of strays) {
        killPid(pid, { sync: true });
      }
      sleepSync(300);
    }

    const stuck = [apiPort, WEB_PORT].filter((port) => listenerPidsSync(port).some((pid) => !foreignPids.has(pid)));
    term(
      stuck.length > 0
        ? `Dev services stopped, but ${stuck.join(" and ")} is still held.\n`
        : "Dev services stopped.\n",
    );
    if (exit) process.exit(0);
  }

  // Raw mode means the console never raises CTRL_C_EVENT, so the key handler
  // above is the normal path; these cover being killed from outside, the window
  // closing, and Ctrl+Break.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => cleanup({ reason: signal }));
  }
  process.on("exit", () => cleanup({ exit: false, reason: "event loop drained" }));
  process.on("uncaughtException", (err) => {
    cleanup({ exit: false, reason: "crash" });
    console.error(err);
    process.exit(1);
  });
}

launchUI(await startup());

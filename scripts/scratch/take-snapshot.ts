/**
 * @file take-snapshot.ts
 * @brief Automated headless browser snapshot generator for DynoFreeChat.
 * @details Spins up a static HTTP server for web/dist, launches headless Edge or Chrome
 *          with Chrome DevTools Protocol enabled, captures full-viewport screenshots
 *          for dark and light themes, and writes them to disk.
 */

import { spawn, type Subprocess } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

/**
 * @brief Configuration parameters for snapshot generation.
 */
interface SnapshotConfig {
  /** Local port for static web server. */
  port: number;
  /** Port for Chrome DevTools Protocol debugging. */
  cdpPort: number;
  /** Viewport width in pixels. */
  width: number;
  /** Viewport height in pixels. */
  height: number;
  /** Theme to snapshot: 'dark', 'light', or 'both'. */
  theme: "dark" | "light" | "both";
  /** Base output path or directory. */
  outBase: string;
  /** Optional element selector to click before capturing snapshot. */
  clickSelector?: string;
}

/**
 * @brief Finds the executable path of Microsoft Edge or Google Chrome.
 * @return The absolute path to the browser binary.
 * @throws {Error} Thrown if neither browser is found in known locations.
 */
function findBrowserExecutable(): string {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("No compatible Chrome or Edge executable found on the system.");
}

/**
 * @brief Pauses execution for a specified duration.
 * @param ms Milliseconds to sleep.
 * @return Promise resolving after the timeout expires.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @brief CDP Client managing communication with a Chromium page target.
 */
class CdpClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (res: unknown) => void>();

  /**
   * @brief Connects to a WebSocket debugging endpoint.
   * @param wsUrl Target WebSocket URL.
   * @return Promise resolving once connection is established.
   */
  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
      this.socket = ws;

      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));

      ws.on("message", (raw) => {
        try {
          const payload = JSON.parse(String(raw)) as {
            id?: number;
            error?: unknown;
            result?: unknown;
          };
          if (payload.id && this.pending.has(payload.id)) {
            const resolver = this.pending.get(payload.id);
            this.pending.delete(payload.id);
            if (payload.error) {
              console.error("CDP Error:", payload.error);
            }
            resolver?.(payload.result);
          }
        } catch (e) {
          console.error("Failed to parse CDP message:", e);
        }
      });
    });
  }

  /**
   * @brief Sends a CDP command and awaits its result.
   * @param method CDP method name (e.g. 'Page.navigate').
   * @param params Parameters for the command.
   * @return Promise resolving to command response.
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.socket?.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * @brief Evaluates a JavaScript expression inside the page context.
   * @param expression JavaScript string to evaluate.
   * @return Evaluated return value.
   */
  async evaluate(expression: string): Promise<any> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  /**
   * @brief Closes the WebSocket connection cleanly.
   */
  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

/**
 * @brief Serves static files from the given directory on the specified port.
 * @param distDir Directory path containing files to serve.
 * @param port Port number to listen on.
 * @return Active Bun server instance.
 */
function startStaticServer(distDir: string, port: number) {
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      let pathname = url.pathname;
      if (pathname === "/" || pathname === "") pathname = "/index.html";

      const filePath = join(distDir, pathname.replace(/^\//, ""));
      if (existsSync(filePath)) {
        const ext = pathname.substring(pathname.lastIndexOf("."));
        const contentType = mimeTypes[ext] ?? "application/octet-stream";
        const body = readFileSync(filePath);
        return new Response(body, {
          headers: { "Content-Type": contentType },
        });
      }

      // SPA fallback
      const indexPath = join(distDir, "index.html");
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

/**
 * @brief Waits until the browser CDP endpoint responds with target list.
 * @param cdpPort Debugging port number.
 * @param timeoutMs Maximum wait time in milliseconds.
 * @return Target page object with webSocketDebuggerUrl.
 * @throws {Error} Thrown if timeout expires before CDP becomes available.
 */
async function waitForCdp(cdpPort: number, timeoutMs = 10000): Promise<{ webSocketDebuggerUrl: string }> {
  const start = Date.now();
  const url = `http://127.0.0.1:${cdpPort}/json/list`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
        const page = targets.find((t) => t.type === "page");
        if (page?.webSocketDebuggerUrl) {
          return page;
        }
      }
    } catch {
      // Waiting for browser to initialize
    }
    await sleep(200);
  }

  throw new Error(`CDP did not become ready on port ${cdpPort} within ${timeoutMs}ms.`);
}

/**
 * @brief Captures a screenshot for a specified theme.
 * @param client Connected CdpClient instance.
 * @param baseUrl Base URL of the web application.
 * @param theme 'dark' or 'light'.
 * @param width Viewport width in pixels.
 * @param height Viewport height in pixels.
 * @param outFile Destination file path for PNG image.
 */
async function captureThemeShot(
  client: CdpClient,
  baseUrl: string,
  theme: "dark" | "light",
  width: number,
  height: number,
  outFile: string,
  clickSelector?: string,
): Promise<void> {
  console.log(`[Snapshot] Preparing ${theme} theme viewport ${width}x${height}...`);

  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Navigate to application
  await client.send("Page.navigate", { url: baseUrl });
  await sleep(1000);

  // Set theme in localStorage and html dataset
  await client.evaluate(`
    localStorage.setItem("dyno.theme", ${JSON.stringify(theme)});
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  `);

  // Navigate again so initialization scripts read updated theme
  await client.send("Page.navigate", { url: baseUrl });
  await sleep(2500);

  if (clickSelector) {
    console.log(`[Snapshot] Clicking element '${clickSelector}'...`);
    await client.evaluate(`
      const target = document.querySelector(${JSON.stringify(clickSelector)});
      if (target) (target).click();
    `);
    await sleep(600);
  }

  // Capture screenshot
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });

  if (result?.data) {
    const buffer = Buffer.from(result.data, "base64");
    writeFileSync(outFile, buffer);
    console.log(`[Snapshot] Saved screenshot to ${outFile} (${buffer.length} bytes).`);
  } else {
    throw new Error(`Failed to capture screenshot data for theme: ${theme}`);
  }
}

/**
 * @brief Main execution function orchestrating web server, browser launch, and snapshot capture.
 */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (prefix: string, fallback: string) => {
    const found = args.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  const config: SnapshotConfig = {
    port: Number(getArg("--port=", "5188")),
    cdpPort: Number(getArg("--cdp-port=", "9223")),
    width: 1440,
    height: 900,
    theme: (getArg("--theme=", "both") as "dark" | "light" | "both") || "both",
    outBase: getArg("--out=", join(process.cwd(), ".shots", "snapshot-current")),
    clickSelector: getArg("--click=", ""),
  };

  const sizeArg = getArg("--size=", "");
  if (sizeArg.includes("x")) {
    const [w, h] = sizeArg.split("x").map(Number);
    if (w && h) {
      config.width = w;
      config.height = h;
    }
  }

  const distDir = join(process.cwd(), "web", "dist");
  if (!existsSync(distDir)) {
    throw new Error(`Distribution directory not found at ${distDir}. Run 'npm run build' first.`);
  }

  const shotsDir = join(process.cwd(), ".shots");
  if (!existsSync(shotsDir)) {
    mkdirSync(shotsDir, { recursive: true });
  }

  const browserBin = findBrowserExecutable();
  console.log(`[Snapshot] Found browser executable at: ${browserBin}`);

  const server = startStaticServer(distDir, config.port);
  console.log(`[Snapshot] Static server listening at http://127.0.0.1:${config.port}`);

  const profileDir = join(process.cwd(), "scripts", "scratch", ".cdp-profile");
  if (existsSync(profileDir)) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Ignore if files locked
    }
  }

  console.log(`[Snapshot] Launching browser process with CDP on port ${config.cdpPort}...`);
  const browserProc: Subprocess = spawn({
    cmd: [
      browserBin,
      "--headless=new",
      `--remote-debugging-port=${config.cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "about:blank",
    ],
    stdout: "ignore",
    stderr: "ignore",
  });

  const cleanup = () => {
    try {
      browserProc.kill();
    } catch {}
    try {
      server.stop();
    } catch {}
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("exit", cleanup);

  try {
    const target = await waitForCdp(config.cdpPort);
    const client = new CdpClient();
    await client.connect(target.webSocketDebuggerUrl);

    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const baseUrl = `http://127.0.0.1:${config.port}/`;

    if (config.theme === "dark" || config.theme === "both") {
      const darkOut = config.outBase.endsWith(".png")
        ? config.outBase.replace(".png", "-dark.png")
        : `${config.outBase}-dark.png`;
      await captureThemeShot(
        client,
        baseUrl,
        "dark",
        config.width,
        config.height,
        darkOut,
        config.clickSelector,
      );
    }

    if (config.theme === "light" || config.theme === "both") {
      const lightOut = config.outBase.endsWith(".png")
        ? config.outBase.replace(".png", "-light.png")
        : `${config.outBase}-light.png`;
      await captureThemeShot(
        client,
        baseUrl,
        "light",
        config.width,
        config.height,
        lightOut,
        config.clickSelector,
      );
    }

    client.close();
    console.log("[Snapshot] Completed successfully.");
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("[Snapshot Error]", err);
  process.exit(1);
});

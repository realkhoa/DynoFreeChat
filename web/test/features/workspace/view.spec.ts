// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketClient } from "@/features/market/board";
import { WorkspaceView, type WorkspaceElements } from "@/features/workspace/view";

/** Static assets the fake fetch serves, keyed by relative path. */
const ASSETS: Record<string, string> = {
  "tree.json": JSON.stringify({
    name: "vinabim_workspace",
    type: "folder",
    path: ".",
    children: [
      {
        name: "VinaBIM",
        type: "folder",
        path: "VinaBIM",
        children: [{ name: "Foo.h", type: "file", path: "VinaBIM/Foo.h", ext: ".h" }],
      },
      { name: "VinaBIM.sln", type: "file", path: "VinaBIM.sln", ext: ".sln" },
    ],
  }),
  "files/VinaBIM.sln": 'Microsoft Visual Studio Solution File\nProject("{x}") = "VinaBIM"\n',
  "files/VinaBIM/Foo.h": "#pragma once\nclass Foo {};\n",
  "files/build_errors.log": [
    "Build started.",
    "C:\\VinaBIM\\01_VinaBIM\\VinaBIM\\VinaBIM\\Foo.h(12,3): error C2065: 'x': undeclared identifier",
    "Build FAILED.",
  ].join("\n"),
};

/** Builds the document hosts the view expects. */
function makeElements(): WorkspaceElements {
  document.body.replaceChildren();
  const panel = document.createElement("section");
  panel.id = "workspace-view";
  panel.innerHTML = `
    <span id="workspace-chip"></span>
    <span id="workspace-state"></span>
    <input id="workspace-filter" />
    <div id="workspace-tree"></div>
    <span id="workspace-file"></span>
    <div id="workspace-gutter"></div>
    <div id="workspace-content"></div>
    <div id="workspace-output-tabs">
      <button data-output-tab="build"></button>
      <button data-output-tab="errors"></button>
      <button data-output-tab="immediate"></button>
    </div>
    <div id="workspace-output"></div>
    <input id="workspace-immediate" />
    <button id="workspace-build-btn"></button>`;
  document.body.append(panel);

  return {
    panel,
    tree: panel.querySelector<HTMLElement>("#workspace-tree")!,
    filter: panel.querySelector<HTMLInputElement>("#workspace-filter")!,
    fileLabel: panel.querySelector<HTMLElement>("#workspace-file")!,
    gutter: panel.querySelector<HTMLElement>("#workspace-gutter")!,
    content: panel.querySelector<HTMLElement>("#workspace-content")!,
    outputTabs: panel.querySelector<HTMLElement>("#workspace-output-tabs")!,
    output: panel.querySelector<HTMLElement>("#workspace-output")!,
    immediate: panel.querySelector<HTMLInputElement>("#workspace-immediate")!,
    chip: panel.querySelector<HTMLElement>("#workspace-chip")!,
    state: panel.querySelector<HTMLElement>("#workspace-state")!,
    buildButton: panel.querySelector<HTMLButtonElement>("#workspace-build-btn")!,
  };
}

/** Fake fetch over the static asset map. */
function fakeFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(ASSETS).find((candidate) => url.endsWith(candidate));
    if (key === undefined) return new Response("missing", { status: 404 });
    return new Response(ASSETS[key], { status: 200 });
  }) as unknown as typeof fetch;
}

/** Fake market client used by the immediate commands. */
function fakeMarket(): MarketClient {
  return {
    quotes: vi.fn(async () => ({
      quotes: [
        {
          symbol: "FPT",
          ref: 131.3,
          ceiling: 140.4,
          floor: 122.2,
          last: 132.5,
          avg: 132.1,
          high: 133.2,
          low: 130.9,
          change: 1.2,
          changePercent: 0.91,
          volume: 1_000,
          foreignBuy: 10,
          foreignRoom: 20,
          side: "BUY",
          bids: [{ price: 132.4, volume: 100 }],
          asks: [{ price: 132.5, volume: 100 }],
        },
      ],
      stale: false,
      ts: 1,
    })),
    indices: vi.fn(async () => ({ indices: [], stale: false, ts: 1 })),
    chart: vi.fn(async () => ({ symbol: "FPT", resolution: "1D", candles: [], ts: 1 })),
    depth: vi.fn(async () => ({ symbol: "FPT", totalVolume: 0, levels: [], ts: 1 })),
    feed: vi.fn(async () => ({
      symbol: "FPT",
      source: "fireant",
      items: [
        {
          id: "fa_1",
          source: "FireAnt",
          author: "An",
          createdAt: "",
          text: "Dòng tiền vào mạnh",
          topic: "",
          likes: 1,
          replies: 0,
          url: "",
        },
      ],
      page: 1,
      maxPage: 1,
      ts: 1,
    })),
  };
}

describe("WorkspaceView", () => {
  let elements: WorkspaceElements;
  let onPlay: ReturnType<typeof vi.fn<() => void>>;
  let view: WorkspaceView;

  beforeEach(() => {
    elements = makeElements();
    onPlay = vi.fn<() => void>();
    view = new WorkspaceView(elements, {
      baseUrl: "https://example.com/workspace/",
      market: fakeMarket(),
      onPlay,
      fetchImpl: fakeFetch(),
    });
  });

  afterEach(() => {
    view.stop();
    document.body.replaceChildren();
  });

  it("loads the tree, counts files and opens the solution file", async () => {
    view.start();
    await vi.waitFor(() => expect(view.fileCount).toBe(2));

    expect(elements.chip.textContent).toBe("// VinaBIM.sln | 2 files");
    expect(elements.tree.textContent).toContain("VinaBIM.sln");
    expect(elements.fileLabel.textContent).toBe("VinaBIM.sln");
    expect(elements.content.textContent).toContain("Microsoft Visual Studio Solution File");
    expect(elements.gutter.children.length).toBeGreaterThan(0);
  });

  it("opens a nested file when its row is clicked", async () => {
    view.start();
    await vi.waitFor(() => expect(view.fileCount).toBe(2));

    elements.tree.querySelector<HTMLElement>('[data-path="VinaBIM/Foo.h"]')?.click();

    await vi.waitFor(() => expect(view.currentFile).toBe("VinaBIM/Foo.h"));
    expect(elements.content.textContent).toContain("#pragma once");
  });

  it("filters the tree by path", async () => {
    view.start();
    await vi.waitFor(() => expect(view.fileCount).toBe(2));

    elements.filter.value = "sln";
    elements.filter.dispatchEvent(new Event("input"));
    expect(elements.tree.textContent).toContain("VinaBIM.sln");
    expect(elements.tree.textContent).not.toContain("Foo.h");

    elements.filter.value = "nothing-matches";
    elements.filter.dispatchEvent(new Event("input"));
    expect(elements.tree.textContent).toContain("no files match");
  });

  it("runs the build and lists the diagnostics", async () => {
    view.start();
    await vi.waitFor(() => expect(view.fileCount).toBe(2));

    await view.build();
    expect(view.currentDiagnostics).toHaveLength(1);
    expect(view.currentDiagnostics[0]?.severity).toBe("error");
    expect(elements.output.textContent).toContain("Build FAILED.");

    elements.outputTabs.querySelector<HTMLElement>('[data-output-tab="errors"]')?.click();
    expect(elements.output.querySelectorAll(".ws-diagnostic")).toHaveLength(1);
    expect(elements.state.textContent).toBe("Build failed");
  });

  it("answers check / cmt / play in the immediate window", async () => {
    view.start();
    await vi.waitFor(() => expect(view.fileCount).toBe(2));

    await view.runCommand("help");
    await view.runCommand("check fpt");
    await view.runCommand("cmt FPT");
    await view.runCommand("play");
    await view.runCommand("nope");
    elements.outputTabs.querySelector<HTMLElement>('[data-output-tab="immediate"]')?.click();

    const text = elements.output.textContent ?? "";
    expect(text).toContain("check <SYM>");
    expect(text).toContain("[FPT] last 132.50");
    expect(text).toContain("An: Dòng tiền vào mạnh");
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(text).toContain("'nope' is not recognized");
  });

  it("reports a missing asset instead of throwing", async () => {
    const brokenElements = makeElements();
    const missing = new WorkspaceView(brokenElements, {
      baseUrl: "https://example.com/workspace/",
      market: fakeMarket(),
      onPlay: vi.fn<() => void>(),
      fetchImpl: (async () => new Response("missing", { status: 404 })) as unknown as typeof fetch,
    });
    missing.start();
    await vi.waitFor(() => expect(brokenElements.state.textContent).toBe("No workspace"));
    missing.stop();
  });
});

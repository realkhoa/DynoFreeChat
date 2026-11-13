// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildSummary,
  countFiles,
  extensionOf,
  filterTree,
  flattenFiles,
  normalizeTree,
  parseBuildErrors,
} from "@/features/workspace/tree";
import { resolveWorkspacePath } from "@/features/workspace/view";

/** Minimal nested tree mirroring the generated workspace payload. */
const RAW_TREE = {
  name: "vinabim_workspace",
  type: "folder",
  path: ".",
  children: [
    {
      name: "VinaBIM",
      type: "folder",
      path: "VinaBIM",
      children: [
        {
          name: "Core",
          type: "folder",
          path: "VinaBIM/Core",
          children: [{ name: "Foo.h", type: "file", path: "VinaBIM/Core/Foo.h", ext: ".h" }],
        },
        { name: "Bar.cpp", type: "file", path: "VinaBIM/Bar.cpp", ext: ".cpp" },
      ],
    },
    { name: "VinaBIM.sln", type: "file", path: "VinaBIM.sln", ext: ".sln" },
    { name: "broken" },
  ],
};

const LOG = [
  "Build started 9/17/2026 6:05:59 PM.",
  "C:\\VinaBIM\\01_VinaBIM\\VinaBIM\\Core\\Foo.h(42,7): error C2065: 'x': undeclared identifier",
  "C:\\VinaBIM\\01_VinaBIM\\VinaBIM\\Bar.cpp : warning C4996: deprecated function",
  "1>VinaBIM.vcxproj -> C:\\VinaBIM\\bin\\VinaBIM.exe",
].join("\n");

describe("normalizeTree", () => {
  it("keeps folders, files and their paths", () => {
    const root = normalizeTree(RAW_TREE);
    expect(root?.path).toBe(".");
    expect(countFiles(root!)).toBe(4);
    expect(flattenFiles(root!).map((file) => file.path)).toEqual([
      "VinaBIM/Core/Foo.h",
      "VinaBIM/Bar.cpp",
      "VinaBIM.sln",
      "broken",
    ]);
  });

  it("drops malformed nodes and fills the extension", () => {
    const root = normalizeTree({ name: "r", type: "folder", children: [{ name: "a.h" }, null, {}] });
    expect(root?.children).toHaveLength(1);
    expect(root?.children?.[0]?.ext).toBe(".h");
  });

  it("rejects a payload that is not a tree", () => {
    expect(normalizeTree(null)).toBeNull();
    expect(normalizeTree([])).toBeNull();
  });
});

describe("extensionOf", () => {
  it("reads the lower-case suffix", () => {
    expect(extensionOf("Foo.H")).toBe(".h");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("filterTree", () => {
  it("keeps the ancestors of a matching file", () => {
    const root = normalizeTree(RAW_TREE)!;
    const filtered = filterTree(root, "foo");
    expect(flattenFiles(filtered!).map((file) => file.path)).toEqual(["VinaBIM/Core/Foo.h"]);
  });

  it("returns the whole subtree when a folder matches", () => {
    const root = normalizeTree(RAW_TREE)!;
    const filtered = filterTree(root, "core");
    expect(flattenFiles(filtered!).map((file) => file.path)).toEqual(["VinaBIM/Core/Foo.h"]);
  });

  it("returns null when nothing matches and the tree when the query is empty", () => {
    const root = normalizeTree(RAW_TREE)!;
    expect(filterTree(root, "zzz")).toBeNull();
    expect(filterTree(root, "  ")).toBe(root);
  });
});

describe("parseBuildErrors", () => {
  it("extracts errors and warnings with their line numbers", () => {
    const diagnostics = parseBuildErrors(LOG);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      line: 42,
      file: expect.stringContaining("Foo.h"),
    });
    expect(diagnostics[0]?.message).toContain("undeclared identifier");
    expect(diagnostics[1]).toMatchObject({ severity: "warning", line: 0 });
  });

  it("ignores log noise", () => {
    expect(parseBuildErrors("Build started.\nBuild succeeded.")).toEqual([]);
  });

  it("summarizes the diagnostic counts", () => {
    expect(buildSummary(parseBuildErrors(LOG))).toBe("1 Warning(s)  1 Error(s)");
  });
});

describe("resolveWorkspacePath", () => {
  it("matches the longest suffix against the known files", () => {
    const paths = ["VinaBIM/Core/Foo.h", "VinaBIM/Bar.cpp", "VinaBIM.sln"];
    expect(resolveWorkspacePath("C:\\VinaBIM\\01_VinaBIM\\VinaBIM\\Core\\Foo.h", paths)).toBe(
      "VinaBIM/Core/Foo.h",
    );
    expect(resolveWorkspacePath("C:\\VinaBIM\\01_VinaBIM\\VinaBIM\\VinaBIM.sln", paths)).toBe("VinaBIM.sln");
  });

  it("returns the input when nothing matches", () => {
    expect(resolveWorkspacePath("D:\\other\\Thing.h", ["VinaBIM/Core/Foo.h"])).toBe("D:\\other\\Thing.h");
  });
});

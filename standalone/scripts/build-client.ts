// Standalone client build: bundles the SHARED client entry
// (`../../client/src/main.tsx`) into `standalone/dist/app.js` + `app.css`.
//
// Run with `bun run build` from `standalone/`.
//
// Two Bun 1.4.4 behaviours forced the shape of this script (both verified
// by experiment in /tmp, not assumed):
//
// 1. `Bun.build({ alias: { "@hatch/space-sdk": "<file>", ... } })` does
//    NOT redirect imports from an entrypoint that lives OUTSIDE the build
//    root: file-valued aliases are silently ignored, and directory-valued
//    aliases only apply to files under the root. So the redirect is done
//    with a `Bun.plugin`-style `onResolve` hook instead, which DOES fire
//    for out-of-tree entries:
//      - `@hatch/space-sdk`        -> `shim/space-sdk/dist/index.js`
//      - `@hatch/space-sdk/client` -> `shim/space-sdk/dist/client.js`
// 2. Bare JS imports in the shared client (`react`, `react-dom`,
//    `@tanstack/react-query`, `recharts`, ...) resolve by walking up from
//    `client/src/` — on a Windows machine where only `standalone/` was
//    installed, that walk-up finds no `node_modules` at all. The same
//    `onResolve` hook therefore falls back to resolving every bare
//    specifier from `standalone/package.json` (i.e. from
//    `standalone/node_modules`), so the bundle always uses one copy of
//    each dependency. Relative imports are untouched.
//
// CSS `@import "tailwindcss"` / `@import "tailwindcss-safe-area"` inside
// `client/src/theme.css` are handled by `bun-plugin-tailwind` (Tailwind's
// own compiler resolves them). The script also sets
// `process.env.NODE_PATH` to `standalone/node_modules` before building so
// that any resolver honouring `NODE_PATH` (Bun's does) can find the
// packages from the out-of-tree CSS file as well.
//
// 3. Tailwind's native (Oxide) compiler does NOT honour NODE_PATH or Bun
//    plugin hooks for those CSS imports: it walks up `node_modules` from
//    `client/src/` and fails with "Can't resolve 'tailwindcss'" on a
//    machine where only `standalone/` was installed. The script therefore
//    links `client/node_modules` -> `../standalone/node_modules` (junction
//    on Windows, symlink on POSIX) when it is missing — see the block
//    below. That is the ONE write the build makes outside `standalone/`,
//    into a gitignored directory; no tracked file under `client/` is ever
//    modified, and `client/build.mjs` stays untouched (it is blocked by the
//    SDK on purpose).

import tailwindPlugin from "bun-plugin-tailwind";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const STANDALONE_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(STANDALONE_DIR, "..");
const ENTRY = join(REPO_ROOT, "client", "src", "main.tsx");
const OUTDIR = join(STANDALONE_DIR, "dist");
const SHIM_DIR = join(STANDALONE_DIR, "shim", "space-sdk");
const NODE_MODULES = join(STANDALONE_DIR, "node_modules");

// Let NODE_PATH-aware resolvers (Bun's, and Tailwind's if it honours it)
// find standalone/node_modules from out-of-tree files.
process.env.NODE_PATH = NODE_MODULES;

// Tailwind's native (Oxide) compiler resolves `@import "tailwindcss"` /
// `@import "tailwindcss-safe-area"` in `client/src/theme.css` by walking
// up `node_modules` from `client/src/` — it does NOT honour NODE_PATH or
// Bun's plugin hooks, so on a machine where only `standalone/` was
// installed the build fails with "Can't resolve 'tailwindcss'".
// Fix: link `client/node_modules` -> `../standalone/node_modules` (a
// directory junction on Windows, which needs no admin rights; a plain
// symlink on POSIX) ONLY for the duration of this build — the link is
// removed again in the `finally` block below, so the shared tree is left
// exactly as it was (a leftover link would change module resolution for
// anything running from `client/src/`, e.g. the Muse-side typecheck,
// and make it resolve the standalone shim instead of the real SDK).
// `client/node_modules/` is gitignored, nothing tracked changes, and the
// link is created only when missing.
const linkPath = join(REPO_ROOT, "client", "node_modules");
const linkTarget = join("..", "standalone", "node_modules");
let createdClientNodeModulesLink = false;
{
  let needsLink = true;
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      needsLink = readlinkSync(linkPath) !== linkTarget;
    } else {
      needsLink = false; // A real directory/file is already there: leave it alone.
    }
  } catch {
    needsLink = true;
  }
  if (needsLink) {
    try {
      mkdirSync(join(REPO_ROOT, "client"), { recursive: true });
      symlinkSync(linkTarget, linkPath, "junction");
      createdClientNodeModulesLink = true;
      console.log(`Đã tạo liên kết tạm ${linkPath} -> ${linkTarget} (để Tailwind tìm thấy gói; sẽ gỡ sau khi build).`);
    } catch (e) {
      console.warn(
        `Không tạo được liên kết client/node_modules (${e instanceof Error ? e.message : String(e)}). ` +
          `Nếu build lỗi "Can't resolve 'tailwindcss'", hãy tạo tay: trên Windows chạy "mklink /J client\\node_modules standalone\\node_modules" tại gốc repo.`,
      );
    }
  }
}

const requireFromStandalone = createRequire(join(STANDALONE_DIR, "package.json"));

function resolveCssPackage(specifier: string): string | undefined {
  // Resolve a CSS `@import "<package>"` to that package's stylesheet:
  // prefer the `style` condition of the "." export, else a `.css` main.
  try {
    const pkgJsonPath = requireFromStandalone.resolve(`${specifier}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
      main?: string;
      style?: string;
    };
    const pkgDir = pkgJsonPath.slice(0, -"/package.json".length);
    const dotExport = pkg.exports?.["."] as
      | { style?: string }
      | string
      | undefined;
    const style =
      (typeof dotExport === "object" ? dotExport.style : undefined) ??
      pkg.style ??
      (typeof pkg.main === "string" && pkg.main.endsWith(".css")
        ? pkg.main
        : undefined);
    if (style) {
      const candidate = resolve(pkgDir, style);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall through to Bun's default resolution.
  }
  return undefined;
}

const standaloneResolvePlugin = {
  name: "standalone-resolve",
  setup(build: {
    onResolve: (
      opts: { filter: RegExp },
      cb: (args: {
        path: string;
        kind: string;
        importer: string;
      }) => { path: string } | undefined,
    ) => void;
  }) {
    // 1. The SDK shim — exact matches only.
    build.onResolve({ filter: /^@hatch\/space-sdk(\/client)?$/ }, (args) => {
      const sub =
        args.path === "@hatch/space-sdk/client"
          ? "dist/client.js"
          : "dist/index.js";
      return { path: join(SHIM_DIR, sub) };
    });
    // 2. Every other bare specifier: resolve from standalone/node_modules.
    //    Skip relative/absolute paths, builtins, and URLs. CSS @imports
    //    (kind "import-rule") resolve to the package's stylesheet.
    build.onResolve(
      { filter: /^(?![./]|node:|bun:|data:|https?:|blob:)[^:]+$/ },
      (args) => {
        if (args.path.startsWith("@hatch/")) return undefined;
        if (args.kind === "import-rule") {
          const css = resolveCssPackage(args.path);
          if (css) return { path: css };
          return undefined;
        }
        try {
          return { path: requireFromStandalone.resolve(args.path) };
        } catch {
          // Leave it to Bun's default resolution (it will report the error).
          return undefined;
        }
      },
    );
  },
};

try {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: OUTDIR,
    target: "browser",
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    naming: {
      entry: "app.[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    plugins: [tailwindPlugin, standaloneResolvePlugin],
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("buildClient() failed; see logged diagnostics");
  }

  // Copy the host page into dist/ (it references /app.js and /app.css).
  writeFileSync(
    join(OUTDIR, "index.html"),
    readFileSync(join(STANDALONE_DIR, "client", "index.html"), "utf8"),
  );

  const jsPath = join(OUTDIR, "app.js");
  const cssPath = join(OUTDIR, "app.css");
  for (const [label, path] of [
    ["app.js", jsPath],
    ["app.css", cssPath],
  ] as const) {
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`Build xong nhưng ${label} không tồn tại hoặc rỗng (${path}).`);
    }
  }

  const jsSize = (statSync(jsPath).size / 1024).toFixed(1);
  const cssSize = (statSync(cssPath).size / 1024).toFixed(1);
  console.log(`Build client xong: dist/app.js ${jsSize} KB, dist/app.css ${cssSize} KB.`);
} finally {
  // Gỡ liên kết tạm đã tạo ở trên (nếu có) để cây source chung không bị
  // thay đổi sau khi build — xem ghi chú ở khối tạo liên kết.
  if (createdClientNodeModulesLink) {
    try {
      unlinkSync(linkPath);
    } catch {
      // Không chặn build vì gỡ link lỗi; link nằm trong thư mục gitignored.
    }
  }
}

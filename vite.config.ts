import { defineConfig } from "vite";
import { execSync } from "child_process";
import { resolve } from "path";
import preact from "@preact/preset-vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import svgr from "vite-plugin-svgr";

/** Deployed commit, injected so the footer can link the exact source build. */
function commitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "";
  }
}

/**
 * The buffer shim ships separate ESM and CJS entries, each with its own
 * inlined Buffer class, and the production build mixes both (gramjs gets the
 * ESM one injected; crypto-browserify `require`s the CJS one). gramjs's
 * `instanceof Buffer` then fails on SRP hashes — "Bytes or str expected" on
 * 2FA login. Pin every import of the shim to the ESM file. A resolve.alias
 * won't do: the polyfill plugin's own `buffer` alias re-resolves with the
 * alias step skipped, so only a resolveId hook sees the shim specifier.
 */
function dedupeBufferShim() {
  const shimFile = resolve(
    __dirname,
    "node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js",
  );
  return {
    name: "dedupe-buffer-shim",
    enforce: "pre" as const,
    resolveId(id: string) {
      if (id === "vite-plugin-node-polyfills/shims/buffer") return shimFile;
    },
  };
}

export default defineConfig({
  base: "/rewindly/",
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash()),
  },
  root: "src",
  // Load .env from the project root, not from `root` (src), which is Vite's default.
  envDir: __dirname,
  plugins: [preact(), svgr(), nodePolyfills(), dedupeBufferShim()],
  appType: "mpa",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        "404": resolve(__dirname, "src/404.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
  test: {
    root: ".",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

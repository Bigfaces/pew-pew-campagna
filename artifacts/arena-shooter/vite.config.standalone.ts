// ================================================================
// STANDALONE BUILD — one self-contained .html file
// ================================================================
// Produces a single HTML file with every byte of CSS and JS inlined,
// openable by double-click with no server and no network access.
//
// This is possible only because the game already ships zero assets:
// wall textures are drawn in code at startup and every sound is
// synthesized through Web Audio. There is nothing left to fetch.
//
// Two details make it actually work from a file:// URL:
//
//   • The bundle is emitted as IIFE, not ESM. Browsers block
//     <script type="module"> over file:// under CORS, so an inlined
//     module script would still refuse to run.
//
//   • Online play is compiled out. From file:// the page has no
//     origin to derive a signaling URL from, so the lobby could only
//     ever fail — better to not offer the button than to offer one
//     that always errors.
// ================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Turn the inlined `<script type="module">` into a classic script, and
 *  move it to the end of the body.
 *
 *  Both halves are required, and the second half is the subtle one.
 *  Stripping `type="module"` is what makes the file work over file:// —
 *  browsers block module scripts there under CORS — and it is safe only
 *  because the bundle is emitted as IIFE. But `type="module"` also
 *  implies *deferred*: the script waits for the document to be parsed.
 *  A classic script does not, and `defer` is ignored on inline scripts,
 *  so the moment the attribute came off, 268 kB of application code
 *  began running inside <head>, before <body> existed. `main.tsx` then
 *  called createRoot on a #root that was not there yet and threw, and
 *  the page rendered nothing at all — a black screen, from a build that
 *  reported success and a dev server that was unaffected, because the
 *  dev config keeps the module script and therefore the defer.
 *
 *  Relocating it is the fix: after </div id="root"> exists in the
 *  parse, a classic script behaves exactly like the deferred module one.
 *
 *  Runs in writeBundle, after vite-plugin-singlefile has done its
 *  inlining in generateBundle. */
function classicScript(outDir: string): Plugin {
  return {
    name: 'standalone:classic-script',
    enforce: 'post',
    writeBundle() {
      const file = path.join(outDir, 'index.html');
      const html = readFileSync(file, 'utf8');

      let patched = html.replace(
        /<script([^>]*)\stype="module"([^>]*)>/g,
        '<script$1$2>',
      );

      // Lift the whole inlined script out of <head> and drop it in just
      // before </body>. Sliced by index rather than matched by regex:
      // the body is a quarter of a megabyte of minified JavaScript, and
      // it is substituted through a replacer function because that text
      // certainly contains `$&`-style sequences that string replacement
      // would interpret rather than insert.
      const open = patched.indexOf('<script');
      const close = patched.indexOf('</script>', open);
      if (open !== -1 && close !== -1) {
        const block = patched.slice(open, close + '</script>'.length);
        patched = patched.slice(0, open) + patched.slice(close + '</script>'.length);
        patched = patched.replace('</body>', () => `  ${block}\n  </body>`);
      }

      // Inline the favicon too, so the .html can be moved or emailed
      // on its own without leaving a broken reference behind.
      try {
        const svg = readFileSync(
          path.resolve(import.meta.dirname, 'public/favicon.svg'),
          'utf8',
        );
        const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        patched = patched.replace(/href="\.\/favicon\.svg"/g, `href="${uri}"`);
      } catch {
        // No favicon is cosmetic; never fail the build over it.
      }

      // Fail loudly rather than shipping a page that silently does
      // nothing when double-clicked.
      if (/<script[^>]*type="module"/.test(patched)) {
        throw new Error('standalone build still contains a module script');
      }
      if (!/<script[^>]*>[\s\S]{10000,}?<\/script>/.test(patched)) {
        throw new Error('standalone build has no inlined script body');
      }
      // The one that would have caught the black screen: a classic
      // script that runs before its mount point is parsed renders
      // nothing, and every other check here still passes.
      const scriptAt = patched.indexOf('<script');
      const rootAt = patched.indexOf('id="root"');
      if (rootAt === -1) {
        throw new Error('standalone build has no #root mount point');
      }
      if (scriptAt < rootAt) {
        throw new Error(
          'standalone build runs its script before #root exists — ' +
            'a classic script is not deferred, so it must come after the ' +
            'mount point or createRoot gets null and the page stays blank',
        );
      }

      writeFileSync(file, patched);
    },
  };
}

const outDir = path.resolve(import.meta.dirname, 'dist/standalone');

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), classicScript(outDir)],
  define: {
    // Compiles the multiplayer entry points out of the UI.
    'import.meta.env.VITE_STANDALONE': JSON.stringify('1'),
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir,
    emptyOutDir: true,
    // Inlining is the whole point; no size warning is useful here.
    chunkSizeWarningLimit: 100_000,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});

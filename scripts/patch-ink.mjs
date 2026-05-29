// Neutralize ink's React DevTools integration so `bun build --compile` doesn't
// try to bundle/resolve the optional `react-devtools-core` dev dependency.
// devtools.js is only loaded when DEV=true, so emptying it is safe in production.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const stub = "// neutralized by scripts/patch-ink.mjs (react-devtools-core not bundled)\nexport {};\n";

// Empty devtools files entirely
const stubs = [
  "node_modules/ink/build/devtools.js",
  "node_modules/ink/build/devtools-window-polyfill.js",
];
for (const rel of stubs) {
  const p = resolve(process.cwd(), rel);
  if (existsSync(p)) {
    writeFileSync(p, stub, "utf8");
    console.log(`  patched ${rel}`);
  }
}

// Patch reconciler.js: remove the DEV block that does import.meta.resolve + await import('./devtools.js')
const reconcilerPath = resolve(process.cwd(), "node_modules/ink/build/reconciler.js");
if (existsSync(reconcilerPath)) {
  let src = readFileSync(reconcilerPath, "utf8");
  // Remove the entire if (process.env['DEV'] === 'true') { ... } block
  const patched = src.replace(
    /if\s*\(\s*process\.env\[['"]DEV['"]\]\s*===\s*['"]true['"]\s*\)\s*\{[\s\S]*?^\}/m,
    "// DEV devtools block removed by scripts/patch-ink.mjs"
  );
  if (patched !== src) {
    writeFileSync(reconcilerPath, patched, "utf8");
    console.log(`  patched node_modules/ink/build/reconciler.js`);
  } else {
    console.log(`  reconciler.js already patched or pattern not found`);
  }
}

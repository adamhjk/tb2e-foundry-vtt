import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { existsSync, readdirSync, rmSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKS_DIR = resolve(ROOT, "packs");
const SOURCE_DIR = resolve(PACKS_DIR, "_source");

const args = process.argv.slice(2);
const mode = args.includes("--compile") ? "compile"
  : args.includes("--extract") ? "extract"
  : null;

if ( !mode ) {
  console.error("Usage: node utils/packs.mjs --compile | --extract");
  process.exit(1);
}

const packs = readdirSync(SOURCE_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for ( const pack of packs ) {
  const src = resolve(SOURCE_DIR, pack);
  const dest = resolve(PACKS_DIR, pack);

  if ( mode === "compile" ) {
    console.log(`Compiling ${pack}...`);
    rmSync(dest, { recursive: true, force: true });
    await compilePack(src, dest, { yaml: true, log: true });
  }
  else if ( mode === "extract" ) {
    if ( !existsSync(dest) ) {
      console.warn(`Skipping ${pack} — no compiled pack found.`);
      continue;
    }
    console.log(`Extracting ${pack}...`);
    await extractPack(dest, src, { yaml: true });
  }
}

console.log("Done.");

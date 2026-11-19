#!/usr/bin/env node
import fs from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node native-patches/patch-android-api-36.mjs <app/build.gradle.kts>");
  process.exit(2);
}
if (!fs.existsSync(target)) {
  console.error(`Android Gradle file not found: ${target}`);
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");

function upgrade(field) {
  const current = new RegExp(`(^\\s*${field}\\s*=\\s*)35(\\s*$)`, "m");
  const already = new RegExp(`^\\s*${field}\\s*=\\s*36\\s*$`, "m");
  const count = (source.match(new RegExp(`^\\s*${field}\\s*=\\s*35\\s*$`, "gm")) || []).length;
  if (count === 1) {
    source = source.replace(current, (_match, prefix, suffix) => `${prefix}36${suffix}`);
    return;
  }
  if (count === 0 && already.test(source)) return;
  throw new Error(`Expected exactly one ${field} = 35 entry (or an already-upgraded ${field} = 36); found ${count}.`);
}

upgrade("compileSdk");
upgrade("targetSdk");

fs.writeFileSync(target, source);
console.log("Upgraded Android compileSdk and targetSdk to API 36.");

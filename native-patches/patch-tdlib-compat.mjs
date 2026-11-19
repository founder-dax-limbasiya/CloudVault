#!/usr/bin/env node
import fs from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node native-patches/patch-tdlib-compat.mjs <TelegramManager.kt>");
  process.exit(2);
}
if (!fs.existsSync(target)) {
  console.error(`TelegramManager source not found: ${target}`);
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");

const obsoleteEncryptionState = [
  "            is TdApi.AuthorizationStateWaitEncryptionKey -> {",
  "                val keyString = databaseKeyString()",
  "                client?.send(TdApi.CheckDatabaseEncryptionKey(keyString)) { result ->",
  '                    if (result is TdApi.Error) onAuthState?.invoke("error:${tdError(result)}")',
  "                }",
  "            }"
].join("\n");

if (source.includes(obsoleteEncryptionState)) {
  source = source.replace(obsoleteEncryptionState, "");
} else if (
  source.includes("AuthorizationStateWaitEncryptionKey") ||
  source.includes("CheckDatabaseEncryptionKey")
) {
  throw new Error("TDLib encryption handler changed; refusing an unsafe partial patch.");
}

const oldCleanup = "uploadsByPath.values.forEach { it.file.delete() }";
const newCleanup = "uploadsByPath.values.forEach { it.upload.file.delete() }";

if (source.includes(oldCleanup)) {
  source = source.replace(oldCleanup, newCleanup);
} else if (!source.includes(newCleanup)) {
  throw new Error("Upload cleanup code did not match the expected TDLib source.");
}

fs.writeFileSync(target, source);
console.log("Applied TDLib 1.8.56 compatibility fixes.");

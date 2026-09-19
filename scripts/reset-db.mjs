import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./lib.mjs";

/**
 * Wipes the database and every uploaded file. Destructive on purpose: this is
 * the "start over" button while developing.
 */

const dir = dataDir();
const force = process.argv.includes("--yes") || process.argv.includes("-y");

if (!fs.existsSync(dir)) {
  console.log(`Nothing to remove: ${dir} does not exist.`);
  process.exit(0);
}

if (!force) {
  console.log(`This will permanently delete:\n  ${dir}\n`);
  console.log("Everything in it goes: the database, uploaded clips, and voice notes.");
  console.log("Re-run with --yes to confirm:\n\n  npm run db:reset -- --yes\n");
  process.exit(1);
}

try {
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
} catch (err) {
  if (err.code === "EPERM" || err.code === "EBUSY") {
    // Windows keeps an exclusive lock on the SQLite file while the dev server
    // has it open, and the error alone does not say so.
    console.error(
      `Could not delete ${err.path ?? dir}.\n\n` +
        "The dev server is probably still running and holding the database open.\n" +
        "Stop it (Ctrl+C) and run this again.",
    );
    process.exit(1);
  }
  throw err;
}

console.log(`Cleared ${dir}. The next request will recreate an empty database.`);

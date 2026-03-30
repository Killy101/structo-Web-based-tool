import { execSync } from "node:child_process";

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", ...options });
}

const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => f.startsWith("frontend/"));

if (staged.length === 0) {
  console.log("[precommit] No staged frontend files. Skipping checks.");
  process.exit(0);
}

const lintTargets = staged.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
const typecheckTargets = staged.filter((f) => /\.(ts|tsx)$/.test(f));

if (lintTargets.length > 0) {
  const relLintTargets = lintTargets.map((f) => f.replace(/^frontend\//, ""));
  console.log(`[precommit] Linting ${relLintTargets.length} staged file(s)...`);
  run(`npm run lint -- ${relLintTargets.join(" ")}`, { cwd: "frontend" });
} else {
  console.log("[precommit] No staged JS/TS files to lint.");
}

if (typecheckTargets.length > 0) {
  const relTypeTargets = typecheckTargets.map((f) => f.replace(/^frontend\//, ""));
  console.log(`[precommit] Typechecking ${relTypeTargets.length} staged TS file(s)...`);
  run(
    `npx tsc-files --noEmit --pretty false ${relTypeTargets.join(" ")}`,
    { cwd: "frontend" },
  );
} else {
  console.log("[precommit] No staged TS files. Skipping typecheck.");
}

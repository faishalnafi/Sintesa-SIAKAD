#!/usr/bin/env node
import { execSync } from "child_process";

function run(cmd, capture = false) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
    });
  } catch (err) {
    if (capture) return null;
    throw err;
  }
}

function getChangedFiles() {
  const status = run("git status -s", true);
  if (!status || !status.trim()) return [];
  return status
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).slice(1).join(" "))
    .filter(Boolean);
}

function getCurrentBranch() {
  const branch = run("git rev-parse --abbrev-ref HEAD", true);
  return branch ? branch.trim() : "main";
}

function generateCommitMessage(files, customMsg) {
  if (customMsg && customMsg.trim()) {
    return customMsg.trim();
  }

  // Detect scope
  const hasApi = files.some((f) => f.includes("apps/api"));
  const hasWeb = files.some((f) => f.includes("apps/web"));
  const hasDocs = files.some((f) => f.includes("docs") || f.endsWith(".md"));
  const hasConfig = files.some((f) => f.includes("package.json") || f.includes("tsconfig"));

  let scope = "app";
  if (hasApi && hasWeb) scope = "fullstack";
  else if (hasApi) scope = "api";
  else if (hasWeb) scope = "web";
  else if (hasDocs) scope = "docs";
  else if (hasConfig) scope = "config";

  const fileCount = files.length;
  const firstFile = files[0] ? files[0].split("/").pop() : "files";
  const desc = fileCount > 1 ? `update ${firstFile} and ${fileCount - 1} other files` : `update ${firstFile}`;

  const now = new Date();
  const timeStr = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `feat(${scope}): ${desc} [${timeStr}]`;
}

function commitAndPush(customMsg) {
  const files = getChangedFiles();
  if (files.length === 0) {
    console.log("ℹ️  Tidak ada perubahan file (working tree clean).");
    return false;
  }

  const branch = getCurrentBranch();
  const commitMsg = generateCommitMessage(files, customMsg);

  console.log(`\n📦 Terdeteksi ${files.length} perubahan file:`);
  files.slice(0, 5).forEach((f) => console.log(`   - ${f}`));
  if (files.length > 5) {
    console.log(`   ... dan ${files.length - 5} file lainnya`);
  }

  console.log(`\n🚀 Memproses auto-commit...`);
  console.log(`   Commit message: "${commitMsg}"`);
  console.log(`   Target branch : ${branch}`);

  run("git add .");
  run(`git commit -m "${commitMsg}"`);

  console.log(`\n⬆️  Pushing ke origin ${branch}...`);
  try {
    run(`git push origin ${branch}`);
    console.log(`✅ Berhasil di-commit dan di-push ke branch '${branch}'!\n`);
    return true;
  } catch (err) {
    console.error(`❌ Gagal push ke GitHub:`, err.message);
    return false;
  }
}

// Mode Watch atau Mode Sekali Jalan (On-demand)
const args = process.argv.slice(2);
const isWatch = args.includes("--watch") || args.includes("-w");
const customMessage = args.filter((a) => !a.startsWith("-")).join(" ");

if (isWatch) {
  console.log("👀 Auto-commit watcher aktif... (Memantau perubahan setiap 20 detik)");
  console.log("   Tekan Ctrl + C untuk berhenti.\n");

  let isRunning = false;
  setInterval(() => {
    if (isRunning) return;
    const files = getChangedFiles();
    if (files.length > 0) {
      isRunning = true;
      try {
        commitAndPush();
      } catch (e) {
        console.error(e);
      } finally {
        isRunning = false;
      }
    }
  }, 20000);
} else {
  commitAndPush(customMessage);
}

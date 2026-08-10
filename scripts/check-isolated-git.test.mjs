import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import {
  GitIsolationError,
  SCANNED_DIRECTORY,
  WRAPPER_MODULE,
  assertGitIsolation,
  findRawGitSpawns,
  moduleFiles,
  rawGitCalls,
} from "./check-isolated-git.mjs";
import { GIT_VARIABLE_PREFIX, gitSpawn, isolatedEnvironment } from "./isolated-git.mjs";
import { holdsPrivateHalf, loadOwnership } from "./open-core-ownership.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const scratch = [];

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/**
 * Every fixture below is built from this one constant rather than written out,
 * so this file does not trip the gate it tests. That is not a trick to dodge
 * the check: the check reads source, and a fixture describing a violation is
 * indistinguishable from one committed in earnest. Assembling them means no
 * file under `scripts/` needs an exemption except the wrapper, which has to
 * name the binary because wrapping it is its whole job.
 */
const G = "git";

/** A repository-shaped scratch tree with a `scripts/` directory to scan. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "seorak-git-isolation-"));
  scratch.push(root);
  mkdirSync(join(root, SCANNED_DIRECTORY), { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(root, SCANNED_DIRECTORY, name), source);
  }
  return root;
}

test("the wrapper strips every variable git uses to override cwd", () => {
  const ambient = {
    GIT_DIR: "/somewhere/.git",
    GIT_WORK_TREE: "/somewhere",
    GIT_INDEX_FILE: "/somewhere/.git/index",
    GIT_CONFIG_GLOBAL: "/somewhere/gitconfig",
    GIT_CONFIG_SYSTEM: "/etc/gitconfig",
    GIT_OBJECT_DIRECTORY: "/somewhere/.git/objects",
  };
  const restore = { ...process.env };
  Object.assign(process.env, ambient);
  try {
    const environment = isolatedEnvironment();
    for (const name of Object.keys(ambient)) {
      assert.equal(environment[name], undefined, `${name} survived the scrub`);
    }
    assert.equal(
      Object.keys(environment).some((name) => name.startsWith(GIT_VARIABLE_PREFIX)),
      false,
    );
    // PATH and the rest are untouched; this is a scrub, not a clean room.
    assert.equal(environment.PATH, process.env.PATH);
    // Overrides still land, which is what `runHook` needs for its skip variable.
    assert.equal(isolatedEnvironment({ SEORAK_TEST: "1" }).SEORAK_TEST, "1");
  } finally {
    for (const name of Object.keys(ambient)) delete process.env[name];
    Object.assign(process.env, restore);
  }
});

test("a wrapped call obeys cwd even with GIT_DIR pointing somewhere else", () => {
  // The end-to-end claim, made against real git rather than against the env
  // object: two repositories, GIT_DIR naming the wrong one, and the wrapper
  // still answers about the directory it was given.
  const mine = tree({});
  const victim = tree({});
  gitSpawn(["init", "--quiet", "--initial-branch=main"], { cwd: mine });
  gitSpawn(["init", "--quiet", "--initial-branch=main"], { cwd: victim });
  const victimConfig = join(victim, ".git", "config");
  const before = readFileSync(victimConfig, "utf8");

  const restore = process.env.GIT_DIR;
  process.env.GIT_DIR = join(victim, ".git");
  try {
    gitSpawn(["config", "seorak.probe", "wrapped"], { cwd: mine });
    const answer = gitSpawn(["config", "--get", "seorak.probe"], {
      cwd: mine,
      encoding: "utf8",
    });
    assert.equal(answer.stdout.trim(), "wrapped");
  } finally {
    if (restore === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = restore;
  }

  assert.equal(readFileSync(victimConfig, "utf8"), before, "the victim was written to");
});

test("a raw spawn is found wherever it hides", () => {
  // Every shape this repository actually contained on 2026-08-07, plus the
  // multi-line form, an absolute path, and a caller nobody has thought of.
  const shapes = [
    `execFileSync("${G}", ["init"], { cwd: root });`,
    `spawnSync("${G}", argv, { cwd: root });`,
    `await execFileAsync("${G}", args, { cwd: root });`,
    `child_process.execFileSync("${G}", ["log"], {});`,
    `run("${G}", ["status"]);`,
    `execFileSync(\n  "${G}",\n  ["ls-files"],\n);`,
    `spawnSync('${G}', ["init"], {});`,
    `spawnSync('/usr/bin/${G}', ["init"], {});`,
    `spawnSync(\`${G}\`, ["init"], {});`,
  ];
  for (const shape of shapes) {
    assert.equal(rawGitCalls(shape).length, 1, `missed: ${shape}`);
  }
});

test("it does not fire on things that merely mention git", () => {
  for (const innocent of [
    `const message = "${G} is not the problem";`,
    `it("${G} init works", () => {});`,
    `const path = join(root, "${G}");`,
    "const label = repository.git;",
    'gitSync(["init"], { cwd: root });',
    'gitSpawn(["add", "-A"], { cwd: root });',
    "await gitAsync([\"ls-files\"], { cwd: root });",
  ]) {
    assert.deepEqual(rawGitCalls(innocent), [], innocent);
  }
});

test("it derives the file list rather than carrying one", () => {
  // The whole point. A suite added tomorrow is scanned because the directory is
  // walked; nothing here has to be told its name.
  const root = tree({
    "existing.test.mjs": 'import { gitSync } from "./isolated-git.mjs";\n',
    "suite-eleven.test.mjs": `const result = execFileSync("${G}", ["init"]);\n`,
  });
  const found = findRawGitSpawns(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].file, `${SCANNED_DIRECTORY}/suite-eleven.test.mjs`);
  assert.equal(found[0].line, 1);
  assert.ok(moduleFiles(join(root, SCANNED_DIRECTORY)).length === 2);
});

test("the wrapper itself may name the binary, and only the wrapper", () => {
  const raw = `export function gitSync(args) { return execFileSync("${G}", args); }\n`;
  const root = tree({ [WRAPPER_MODULE]: raw, "impostor.mjs": raw });
  const found = findRawGitSpawns(root);
  assert.deepEqual(
    found.map((entry) => entry.file),
    [`${SCANNED_DIRECTORY}/impostor.mjs`],
  );
});

test("the failure names the file, the line and the way out", () => {
  const root = tree({
    "offender.test.mjs": `import x from "y";\n\nconst r = spawnSync("${G}", ["init"], {});\n`,
  });
  assert.throws(
    () => assertGitIsolation(root),
    (error) => {
      assert.ok(error instanceof GitIsolationError);
      assert.match(error.message, /offender\.test\.mjs:3/);
      assert.match(error.message, new RegExp(WRAPPER_MODULE.replace(".", "\\.")));
      assert.match(error.message, /gitSync/);
      assert.match(error.message, /GIT_DIR/);
      return true;
    },
  );
});

test("this repository passes, and the gate is wired where it runs", () => {
  assert.deepEqual(findRawGitSpawns(ROOT), []);

  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["git-isolation:check"],
    "node scripts/check-isolated-git.mjs",
  );
  assert.equal(
    pkg.scripts["git-isolation:test"],
    "node --test scripts/check-isolated-git.test.mjs",
  );
  assert.match(pkg.scripts.test, /git-isolation:test/);
  assert.match(pkg.scripts.test, /git-isolation:check/);

  // WIRING IS PER-REPOSITORY, for the reason advisories:check records: the
  // public tree carries public suites that spawn git, and a contributor there
  // runs them under the same kind of hook. A gate wired in one half only is a
  // gate the other half does not have.
  const { manifest } = loadOwnership(ROOT);
  if (!holdsPrivateHalf(manifest, ROOT)) return;

  for (const path of [".github/workflows/ci.yml", "open-core/.github/workflows/ci.yml"]) {
    const workflow = readFileSync(resolve(ROOT, path), "utf8");
    assert.match(workflow, /npm run git-isolation:test/, path);
    assert.match(workflow, /npm run git-isolation:check/, path);
  }
});

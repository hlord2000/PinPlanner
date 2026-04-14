#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from "fs";
import { readFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_MATRIX_PATH = resolve(
  ROOT,
  "ci",
  "output",
  "closed-loop",
  "matrix.json",
);
const DEFAULT_BOARD_ROOT = resolve(
  ROOT,
  "ci",
  "output",
  "closed-loop",
  "board-root",
);
const DEFAULT_BUILD_ROOT = resolve(
  ROOT,
  "ci",
  "output",
  "closed-loop",
  "builds",
);
const CPUAPP_APP = resolve(ROOT, "ci", "apps", "peripheral-smoke");

function parseArgs(argv) {
  const options = {
    matrixPath: DEFAULT_MATRIX_PATH,
    boardRoot: DEFAULT_BOARD_ROOT,
    buildRoot: DEFAULT_BUILD_ROOT,
    limit: Number.POSITIVE_INFINITY,
    scenarioPattern: null,
    workspace: process.env.NCS_WORKSPACE || null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--matrix=")) {
      options.matrixPath = resolve(arg.split("=").slice(1).join("="));
    } else if (arg.startsWith("--board-root=")) {
      options.boardRoot = resolve(arg.split("=").slice(1).join("="));
    } else if (arg.startsWith("--build-root=")) {
      options.buildRoot = resolve(arg.split("=").slice(1).join("="));
    } else if (arg.startsWith("--workspace=")) {
      options.workspace = resolve(arg.split("=").slice(1).join("="));
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.split("=").slice(1).join("="), 10);
    } else if (arg.startsWith("--scenario-pattern=")) {
      options.scenarioPattern = new RegExp(arg.split("=").slice(1).join("="));
    } else if (arg === "--help") {
      console.log(`Usage: node ci/build-exported-boards.js --workspace=/path/to/ncs

Options:
  --matrix=<path>            Closed-loop matrix JSON
  --board-root=<path>        Extraction directory used as BOARD_ROOT
  --build-root=<path>        Build output directory
  --limit=<n>                Limit the number of scenarios built
  --scenario-pattern=<regex> Filter scenarios by board/scenario name
`);
      process.exit(0);
    }
  }

  if (!options.workspace) {
    throw new Error(
      "NCS workspace is required. Pass --workspace=/path/to/ncs or set NCS_WORKSPACE.",
    );
  }

  return options;
}

function loadMatrix(matrixPath) {
  if (!existsSync(matrixPath)) {
    throw new Error(`Matrix file not found: ${matrixPath}`);
  }
  return JSON.parse(readFileSync(matrixPath, "utf-8"));
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function getSelectedBuildScenarios(options, matrix) {
  const buildableScenarios = [];

  for (const entry of matrix.entries || []) {
    if (!entry.exportSupported) {
      continue;
    }

    for (const scenario of entry.scenarios || []) {
      if (!scenario.build) {
        continue;
      }

      if (
        options.scenarioPattern &&
        !options.scenarioPattern.test(
          `${scenario.boardInfo.name}:${scenario.scenarioName}`,
        )
      ) {
        continue;
      }

      buildableScenarios.push(scenario);
    }
  }

  return buildableScenarios.slice(0, options.limit);
}

function prepareBoardRoot(boardRoot, scenarios) {
  rmSync(boardRoot, { force: true, recursive: true });
  mkdirSync(resolve(boardRoot, "boards", "custom"), { recursive: true });

  for (const scenario of scenarios) {
    const zipPath = resolve(
      ROOT,
      "ci",
      "output",
      "closed-loop",
      "site-zips",
      scenario.mcuId,
      scenario.packageFile,
      `${scenario.boardInfo.name}.zip`,
    );

    if (!existsSync(zipPath)) {
      throw new Error(`Missing site-exported archive: ${zipPath}`);
    }

    runCommand("unzip", [
      "-q",
      "-o",
      zipPath,
      "-d",
      resolve(boardRoot, "boards", "custom"),
    ]);
  }
}

function sanitizeBuildSegment(value) {
  return value.replace(/[^a-z0-9_]+/gi, "_");
}

function getAppPath(target) {
  if (target.endsWith("/cpuflpr") || target.endsWith("/cpuflpr/xip")) {
    return "zephyr/samples/hello_world";
  }

  return CPUAPP_APP;
}

function getExtraCmakeArgs(target) {
  const [mcuId, cpuCluster, variant] = target.split("/");

  if (
    cpuCluster === "cpuflpr" &&
    !variant &&
    (mcuId === "nrf54l05" || mcuId === "nrf54l10")
  ) {
    return ["-DSB_CONFIG_VPR_LAUNCHER=n"];
  }

  return [];
}

function buildScenarios(options, scenarios) {
  rmSync(options.buildRoot, { force: true, recursive: true });
  mkdirSync(options.buildRoot, { recursive: true });

  const failures = [];
  let buildCount = 0;

  for (const scenario of scenarios) {
    for (const target of scenario.targets) {
      const board = `${scenario.boardInfo.name}/${target}`;
      const buildDir = resolve(
        options.buildRoot,
        sanitizeBuildSegment(`${scenario.boardInfo.name}_${target}`),
      );

      console.log(`\n=== Building ${board} ===`);

      try {
        runCommand(
          "west",
          [
            "build",
            "-d",
            buildDir,
            "-b",
            board,
            getAppPath(target),
            "--pristine",
            "always",
            "--",
            `-DBOARD_ROOT=${options.boardRoot}`,
            ...getExtraCmakeArgs(target),
          ],
          {
            cwd: options.workspace,
          },
        );
        buildCount += 1;
      } catch (error) {
        failures.push({
          board,
          error: error.message,
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nBuild failures:");
    for (const failure of failures) {
      console.error(`  - ${failure.board}: ${failure.error}`);
    }
    process.exit(1);
  }

  console.log(`\nBuilt ${buildCount} board target(s) successfully.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = loadMatrix(options.matrixPath);
  const scenarios = getSelectedBuildScenarios(options, matrix);

  prepareBoardRoot(options.boardRoot, scenarios);
  buildScenarios(options, scenarios);
}

main();

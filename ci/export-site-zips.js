#!/usr/bin/env node

import { createReadStream, existsSync, mkdirSync, rmSync } from "fs";
import { stat, writeFile } from "fs/promises";
import { createServer } from "http";
import { extname, join, normalize, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { chromium } from "@playwright/test";
import { generateClosedLoopMatrix } from "./closed-loop-matrix.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_DIR = resolve(ROOT, "ci", "output", "closed-loop");
const ZIP_DIR = resolve(OUTPUT_DIR, "site-zips");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function parseArgs(argv) {
  const options = {
    limit: Number.POSITIVE_INFINITY,
    scenarioPattern: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.split("=").slice(1).join("="), 10);
    } else if (arg.startsWith("--scenario-pattern=")) {
      options.scenarioPattern = new RegExp(arg.split("=").slice(1).join("="));
    } else if (arg === "--help") {
      console.log(`Usage: node ci/export-site-zips.js

Options:
  --limit=<n>                Limit the number of exported scenarios
  --scenario-pattern=<regex> Filter scenarios by board/scenario name
`);
      process.exit(0);
    }
  }

  return options;
}

function ensureCleanOutputDir() {
  rmSync(ZIP_DIR, { force: true, recursive: true });
  mkdirSync(ZIP_DIR, { recursive: true });
}

function safeResolveStaticPath(urlPathname) {
  const pathname = urlPathname === "/" ? "/index.html" : urlPathname;
  const decoded = decodeURIComponent(pathname);
  const fullPath = normalize(resolve(ROOT, `.${decoded}`));

  if (!fullPath.startsWith(ROOT)) {
    return null;
  }

  return fullPath;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const filePath = safeResolveStaticPath(request.url || "/");
      if (!filePath || !existsSync(filePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      response.writeHead(200, {
        "Content-Type":
          MIME_TYPES[extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(`Server error: ${error.message}`);
    }
  });

  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function waitForAppReady(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const selector = document.getElementById("mcuSelector");
    return Boolean(selector && selector.options.length > 0);
  });
}

async function verifyUnsupportedExportState(page, entry) {
  const state = await page.evaluate(async ({ mcuId, packageFile }) => {
    const loader = await import("./js/mcu-loader.js");
    document.getElementById("mcuSelector").value = mcuId;
    await loader.handleMcuChange();
    document.getElementById("packageSelector").value = packageFile;
    await loader.handlePackageChange();

    const button = document.getElementById("exportDeviceTreeBtn");
    return {
      disabled: button.disabled,
      title: button.title,
    };
  }, entry);

  if (!state.disabled) {
    throw new Error(
      `Expected export to stay disabled for ${entry.mcuId}/${entry.packageFile}`,
    );
  }
}

function expectedArchiveFiles(scenario) {
  const boardName = scenario.boardInfo.name;
  const mcu = scenario.mcuId;
  const targets = new Set(scenario.targets);
  const files = new Set([
    "board.yml",
    "board.cmake",
    "Kconfig.defconfig",
    `Kconfig.${boardName}`,
    `${boardName}_common.dtsi`,
    `${mcu}_cpuapp_common.dtsi`,
    `${boardName}_${mcu}-pinctrl.dtsi`,
    `${boardName}_${mcu}_cpuapp.dts`,
    `${boardName}_${mcu}_cpuapp.yaml`,
    `${boardName}_${mcu}_cpuapp_defconfig`,
    "README.md",
  ]);

  if (targets.has(`${mcu}/cpuapp/ns`)) {
    files.add("Kconfig");
    files.add(`${boardName}_${mcu}_cpuapp_ns.dts`);
    files.add(`${boardName}_${mcu}_cpuapp_ns.yaml`);
    files.add(`${boardName}_${mcu}_cpuapp_ns_defconfig`);
  }

  if (targets.has(`${mcu}/cpuflpr`)) {
    files.add(`${boardName}_${mcu}_cpuflpr.dts`);
    files.add(`${boardName}_${mcu}_cpuflpr.yaml`);
    files.add(`${boardName}_${mcu}_cpuflpr_defconfig`);
  }

  if (targets.has(`${mcu}/cpuflpr/xip`)) {
    files.add(`${boardName}_${mcu}_cpuflpr_xip.dts`);
    files.add(`${boardName}_${mcu}_cpuflpr_xip.yaml`);
    files.add(`${boardName}_${mcu}_cpuflpr_xip_defconfig`);
  }

  return files;
}

function listArchiveEntries(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], {
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to inspect archive ${zipPath}: ${result.stderr || result.stdout}`,
    );
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertArchiveShape(zipPath, scenario) {
  const entries = listArchiveEntries(zipPath);
  const prefix = `${scenario.boardInfo.name}/`;

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) {
      throw new Error(
        `Archive ${zipPath} contains unexpected top-level entry ${entry}`,
      );
    }
  }

  const relativeEntries = new Set(
    entries.map((entry) => entry.slice(prefix.length)),
  );
  for (const expectedFile of expectedArchiveFiles(scenario)) {
    if (!relativeEntries.has(expectedFile)) {
      throw new Error(`Archive ${zipPath} is missing ${expectedFile}`);
    }
  }
}

async function exportScenarioZip(page, scenario) {
  const base64Zip = await page.evaluate(async (scenarioData) => {
    localStorage.clear();

    const stateModule = await import("./js/state.js");
    const loader = await import("./js/mcu-loader.js");
    const exporter = await import("./js/export.js");

    const state = stateModule.default;
    await loader.loadMCUData(scenarioData.mcuId, scenarioData.packageFile);

    state.selectedPeripherals = scenarioData.selectedPeripherals;
    state.usedPins = {};
    state.usedAddresses = {};
    state.consoleUart = scenarioData.consoleUart;
    state.devkitConfig = null;
    state.boardInfo = scenarioData.boardInfo;

    const files = await exporter.generateBoardFiles(
      scenarioData.mcuId,
      scenarioData.packageFile,
    );
    const blob = await exporter.createBoardZipBlob(
      files,
      scenarioData.boardInfo.name,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }, scenario);
  const scenarioDir = resolve(ZIP_DIR, scenario.mcuId, scenario.packageFile);
  mkdirSync(scenarioDir, { recursive: true });

  const zipPath = resolve(scenarioDir, `${scenario.boardInfo.name}.zip`);
  await writeFile(zipPath, Buffer.from(base64Zip, "base64"));
  assertArchiveShape(zipPath, scenario);

  return zipPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = generateClosedLoopMatrix();
  ensureCleanOutputDir();

  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    baseURL: baseUrl,
  });
  const page = await context.newPage();

  try {
    await waitForAppReady(page);

    const exported = [];
    let unsupportedChecked = 0;
    let exportedScenarioCount = 0;

    for (const entry of matrix.entries) {
      if (!entry.exportSupported) {
        console.log(
          `Verifying export gating for ${entry.mcuId}/${entry.packageFile}`,
        );
        await verifyUnsupportedExportState(page, entry);
        unsupportedChecked += 1;
        continue;
      }

      for (const scenario of entry.scenarios) {
        if (
          options.scenarioPattern &&
          !options.scenarioPattern.test(
            `${scenario.boardInfo.name}:${scenario.scenarioName}`,
          )
        ) {
          continue;
        }

        if (exportedScenarioCount >= options.limit) {
          break;
        }

        console.log(
          `Exporting ${scenario.boardInfo.name} (${scenario.mcuId}/${scenario.packageFile}/${scenario.scenarioName})`,
        );
        const zipPath = await exportScenarioZip(page, scenario);
        exported.push({
          scenarioName: scenario.scenarioName,
          mcuId: scenario.mcuId,
          packageFile: scenario.packageFile,
          boardName: scenario.boardInfo.name,
          build: scenario.build,
          zipPath,
        });
        exportedScenarioCount += 1;
      }

      if (exportedScenarioCount >= options.limit) {
        break;
      }
    }

    const outputMatrix = {
      ...matrix,
      unsupportedChecked,
      exportedArchives: exported,
    };
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = resolve(OUTPUT_DIR, "matrix.json");
    const matrixText = `${JSON.stringify(outputMatrix, null, 2)}\n`;
    await writeFile(outputPath, matrixText);

    console.log(
      `Exported ${exported.length} archives from the site to ${ZIP_DIR}\n` +
        `Verified export gating for ${unsupportedChecked} unsupported package(s)`,
    );
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

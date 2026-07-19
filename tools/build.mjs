import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { REQUIRED_ROOT_FILES, WORKSPACE_ROOT, validateProject } from "./validate.mjs";

const DIST_DIRECTORY = resolve(WORKSPACE_ROOT, "dist");

function assertSafeOutputDirectory(outputDirectory) {
  const workspaceToOutput = relative(WORKSPACE_ROOT, outputDirectory);
  if (!workspaceToOutput || workspaceToOutput.startsWith("..") || isAbsolute(workspaceToOutput)) {
    throw new Error("The build output directory must be a child of the workspace.");
  }
}

async function copyDirectory(sourceDirectory, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "tests") continue;

    const sourcePath = join(sourceDirectory, entry.name);
    const outputPath = join(outputDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, outputPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, outputPath);
    }
  }
}

async function build() {
  await validateProject();
  assertSafeOutputDirectory(DIST_DIRECTORY);

  await rm(DIST_DIRECTORY, { recursive: true, force: true });
  await mkdir(DIST_DIRECTORY, { recursive: true });

  await Promise.all(
    REQUIRED_ROOT_FILES.map((relativePath) =>
      copyFile(join(WORKSPACE_ROOT, relativePath), join(DIST_DIRECTORY, relativePath)),
    ),
  );
  await copyDirectory(join(WORKSPACE_ROOT, "game"), join(DIST_DIRECTORY, "game"));

  console.log(`Production build written to ${DIST_DIRECTORY}`);
}

build().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

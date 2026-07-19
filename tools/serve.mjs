import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = "127.0.0.1";

const MIME_TYPES = new Map([
  [".aac", "audio/aac"],
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function printHelp() {
  console.log("Usage: node tools/serve.mjs [--root <directory>] [--port <number>] [--host <address>]");
}

function parseArguments(argumentsList) {
  const options = { root: process.cwd(), port: DEFAULT_PORT, host: DEFAULT_HOST };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      printHelp();
      return null;
    }

    const [name, inlineValue] = argument.split("=", 2);
    if (!["--root", "--port", "--host", "-p"].includes(name)) {
      throw new Error(`Unknown option: ${argument}`);
    }

    const value = inlineValue ?? argumentsList[++index];
    if (value === undefined || value.length === 0) {
      throw new Error(`Missing value for ${name}.`);
    }

    if (name === "--root") options.root = value;
    if (name === "--host") options.host = value;
    if (name === "--port" || name === "-p") options.port = Number(value);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("Port must be an integer from 1 to 65535.");
  }
  return options;
}

function isInsideRoot(rootDirectory, targetPath) {
  const rootToTarget = relative(rootDirectory, targetPath);
  return rootToTarget === "" || (!rootToTarget.startsWith(`..${sep}`) && rootToTarget !== ".." && !isAbsolute(rootToTarget));
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(message);
}

async function resolveRequestedFile(rootDirectory, requestUrl) {
  const parsedUrl = new URL(requestUrl, "http://localhost");
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsedUrl.pathname);
  } catch {
    return { status: 400 };
  }

  if (decodedPath.includes("\0")) return { status: 400 };
  const pathSegments = decodedPath.split(/[\\/]+/u).filter(Boolean);
  if (pathSegments.some((segment) => segment.startsWith("."))) return { status: 404 };

  const candidatePath = resolve(rootDirectory, ...pathSegments);
  if (!isInsideRoot(rootDirectory, candidatePath)) return { status: 403 };

  let candidateStats;
  try {
    candidateStats = await stat(candidatePath);
  } catch {
    return { status: 404 };
  }

  let filePath = candidateStats.isDirectory() ? resolve(candidatePath, "index.html") : candidatePath;
  try {
    const actualPath = await realpath(filePath);
    if (!isInsideRoot(rootDirectory, actualPath)) return { status: 403 };
    const fileStats = await stat(actualPath);
    if (!fileStats.isFile()) return { status: 404 };
    filePath = actualPath;
    return { status: 200, filePath, fileStats };
  } catch {
    return { status: 404 };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;

  const configuredRoot = resolve(options.root);
  let rootDirectory;
  try {
    rootDirectory = await realpath(configuredRoot);
    const rootStats = await stat(rootDirectory);
    if (!rootStats.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`Static root is not a readable directory: ${configuredRoot}`);
  }

  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }

    let resolvedRequest;
    try {
      resolvedRequest = await resolveRequestedFile(rootDirectory, request.url ?? "/");
    } catch {
      sendText(response, 400, "Bad Request\n");
      return;
    }

    if (resolvedRequest.status !== 200) {
      const labels = { 400: "Bad Request", 403: "Forbidden", 404: "Not Found" };
      sendText(response, resolvedRequest.status, `${labels[resolvedRequest.status]}\n`);
      return;
    }

    const { filePath, fileStats } = resolvedRequest;
    const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileStats.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  console.log(`Serving ${rootDirectory} at http://${options.host}:${options.port}`);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    server.close(() => {
      process.exitCode = 0;
    });
    setTimeout(() => server.closeAllConnections?.(), 2_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";

const REVIEWABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".php",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".rb",
  ".swift",
  ".kt",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".html",
  ".css",
  ".xml",
  ".sql",
  ".toml"
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "vendor"
]);

const normalizeCommandPath = (rawPath) =>
  rawPath.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

/**
 * Validates that resolvedPath is inside the allowed base path.
 * Prevents path-traversal attacks (e.g. reading /etc or C:\Windows).
 * @throws {Error} if the path is outside the allowed base.
 */
const validatePathSecurity = (resolvedPath) => {
  const allowedBase = env.allowedReviewBasePath;
  if (!allowedBase) return; // no restriction configured

  const normalizedBase = path.resolve(allowedBase);
  const normalizedTarget = path.resolve(resolvedPath);

  if (
    !normalizedTarget.startsWith(normalizedBase + path.sep) &&
    normalizedTarget !== normalizedBase
  ) {
    throw new Error(
      `Ruta no permitida. Solo se pueden revisar proyectos dentro de: ${normalizedBase}`
    );
  }
};

const collectFilesRecursive = async (rootDir, fileLimit) => {
  const results = [];

  const walk = async (currentDir) => {
    if (results.length >= fileLimit) return;
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= fileLimit) break;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (REVIEWABLE_EXTENSIONS.has(ext)) {
          results.push(absolutePath);
        }
      }
    }
  };

  await walk(rootDir);
  return results;
};

export const parseLocalReviewCommand = (text) => {
  const normalized = text.trim();
  const match = normalized.match(/^revisa\s+local\s+(.+)$/i);
  if (!match) return null;
  return normalizeCommandPath(match[1]);
};

export const reviewLocalProject = async ({
  commandPath,
  llmProvider,
  maxFiles,
  maxCharsPerFile,
  logger
}) => {
  const resolvedPath = path.resolve(commandPath);

  // ── Security: validate path is inside allowed base ──
  validatePathSecurity(resolvedPath);

  const rootStat = await stat(resolvedPath);
  if (!rootStat.isDirectory()) {
    throw new Error("La ruta indicada no es una carpeta.");
  }

  const files = await collectFilesRecursive(resolvedPath, maxFiles);
  if (!files.length) {
    return {
      resolvedPath,
      reviewedFiles: 0,
      summary:
        "No encontre archivos de codigo compatibles para revisar en esa ruta."
    };
  }

  const snippets = [];
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf8");
      const clipped = content.slice(0, maxCharsPerFile);
      snippets.push({
        filePath,
        content: clipped
      });
    } catch (error) {
      logger.warn({ err: error, filePath }, "No se pudo leer archivo para review");
    }
  }

  const promptBody = snippets
    .map(
      (snippet, index) =>
        `### Archivo ${index + 1}: ${snippet.filePath}\n` +
        "```text\n" +
        `${snippet.content}\n` +
        "```"
    )
    .join("\n\n");

  const reviewMessages = [
    {
      role: "system",
      content:
        "Eres un revisor de codigo senior. Devuelve hallazgos primero (critico/alto/medio/bajo), indicando archivo, riesgo y fix concreto. Despues agrega un resumen breve."
    },
    {
      role: "user",
      content:
        `Revisa este proyecto local: ${resolvedPath}\n` +
        `Archivos analizados: ${snippets.length}\n\n` +
        promptBody
    }
  ];

  const summary = await llmProvider.generateReply(reviewMessages);
  return {
    resolvedPath,
    reviewedFiles: snippets.length,
    summary
  };
};

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([
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
  ".html",
  ".css",
  ".md",
  ".xml",
  ".sql",
  ".sh",
  ".bat",
  ".toml",
  ".ini",
  ".env",
  ".yml",
  ".yaml"
]);

export const isSupportedCodeFile = (filename = "") => {
  const extension = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension);
};

export const buildEditPrompt = ({ instruction, originalCode, filename }) => [
  {
    role: "system",
    content:
      "Eres un asistente técnico. Devuelve solo el código final modificado, sin explicaciones."
  },
  {
    role: "user",
    content: `Archivo: ${filename}\nInstruccion: ${instruction}\n\nCodigo original:\n${originalCode}`
  }
];

/**
 * Saves the edited file with a timestamp prefix to avoid overwrites.
 * @returns {Promise<string>} the saved file path.
 */
export const saveEditedFile = async (outputDir, filename, content) => {
  await mkdir(outputDir, { recursive: true });
  const base = filename || "edited.txt";
  const ext = path.extname(base);
  const name = path.basename(base, ext);
  const safeName = `${name}-${Date.now()}${ext}`;
  const targetPath = path.join(outputDir, safeName);
  await writeFile(targetPath, content, "utf8");
  return targetPath;
};

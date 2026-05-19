import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Gets all files (or directories) in a directory, non-recursively.
 *
 * @param directory - Absolute path to the directory to scan
 * @param getDirs - When true, returns subdirectory paths instead of file paths
 * @returns Array of absolute paths to matching files or directories
 */
export default async function getAllFiles(directory: string, getDirs = false): Promise<string[]> {
  try {
    const items = await readdir(directory, { withFileTypes: true });
    const result: string[] = [];

    for (const item of items) {
      const itemPath = path.join(directory, item.name);

      if (item.name.startsWith(".")) continue;

      if (item.isDirectory()) {
        if (getDirs) {
          result.push(itemPath);
        }
      } else if (!getDirs && item.isFile()) {
        if (itemPath.endsWith(".js") || itemPath.endsWith(".ts")) {
          result.push(itemPath);
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error);
    return [];
  }
}

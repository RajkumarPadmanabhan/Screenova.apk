import { kindOf } from "./library.js";

const SKIP_DIR = /^(video_ts|bdmv|certificate|\$recycle\.bin|@eadir|node_modules)$/i;

export async function collectFromHandle(dirHandle, onProgress) {
  const entries = [];
  async function walk(handle, prefix) {
    for await (const [name, child] of handle.entries()) {
      if (!name || name.startsWith(".")) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (child.kind === "directory") {
        if (SKIP_DIR.test(name)) continue;
        await walk(child, relativePath);
        continue;
      }
      const kind = kindOf(name);
      if (kind === "other") continue;
      const file = await child.getFile();
      const entry = {
        relativePath,
        name,
        size: file.size,
        lastModified: file.lastModified,
        kind,
        file,
      };
      if (kind === "nfo" && file.size < 500000) {
        try { entry.text = await file.text(); } catch { /* unreadable sidecar */ }
      }
      entries.push(entry);
      if (onProgress && entries.length % 25 === 0) onProgress(entries.length);
    }
  }
  await walk(dirHandle, "");
  if (onProgress) onProgress(entries.length);
  return entries;
}

export async function collectFromFileList(fileList, onProgress) {
  const entries = [];
  for (const file of fileList) {
    const relativePath = file.webkitRelativePath || file.name;
    const name = relativePath.split("/").pop();
    if (!name || name.startsWith(".")) continue;
    const kind = kindOf(name);
    if (kind === "other") continue;
    const entry = {
      relativePath,
      name,
      size: file.size,
      lastModified: file.lastModified,
      kind,
      file,
    };
    if (kind === "nfo" && file.size < 500000) {
      try { entry.text = await file.text(); } catch { /* unreadable sidecar */ }
    }
    entries.push(entry);
    if (onProgress && entries.length % 25 === 0) onProgress(entries.length);
  }
  if (onProgress) onProgress(entries.length);
  return entries;
}

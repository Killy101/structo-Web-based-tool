/**
 * BRD Download Manager
 *
 * Uses the File System Access API (Chrome/Edge) to save BRD output files into
 * organized subfolders inside a user-selected root directory, e.g.:
 *
 *   {root}/brd/
 *   {root}/simplemetajson/
 *   {root}/innodmetajson/
 *   {root}/contentprofile/
 *
 * On the very first download the user is prompted to pick a root folder (e.g.
 * C:\Users\...\Documents\BRD). The handle is cached for the lifetime of the
 * page so subsequent downloads skip the picker.
 *
 * Falls back to a standard <a> download when the API is unavailable (Firefox,
 * Safari, or when running in an iframe).
 */

export type BrdOutputType = "brd" | "simplemetajson" | "innodmetajson" | "contentprofile";

const SUBFOLDER: Record<BrdOutputType, string> = {
  brd: "brd",
  simplemetajson: "simplemetajson",
  innodmetajson: "innodmetajson",
  contentprofile: "contentprofile",
};

// Cached root directory handle — lives for the duration of the page session.
let _rootHandle: FileSystemDirectoryHandle | null = null;

function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window &&
    typeof (window as Record<string, unknown>).showDirectoryPicker === "function"
  );
}

function triggerFallbackDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Save `blob` as `filename` inside the subfolder corresponding to `outputType`.
 *
 * On the first call the user is prompted to select the BRD root directory.
 * Subsequent calls reuse the cached directory handle.
 *
 * If the user cancels the picker, or if the browser does not support the File
 * System Access API, the file is downloaded via the normal browser mechanism
 * (goes to the default Downloads folder).
 */
export async function downloadBrdOutput(
  blob: Blob,
  filename: string,
  outputType: BrdOutputType,
): Promise<void> {
  if (!supportsFileSystemAccess()) {
    triggerFallbackDownload(blob, filename);
    return;
  }

  type DirectoryPickerFn = (opts?: {
    id?: string;
    startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;

  // Type-assert via unknown to access the non-standard API without polluting global typings.
  const showDirectoryPicker = (window as unknown as { showDirectoryPicker: DirectoryPickerFn }).showDirectoryPicker;

  try {
    if (!_rootHandle) {
      _rootHandle = await showDirectoryPicker({
        id: "brd-output-root",
        startIn: "documents",
        mode: "readwrite",
      });
    }

    const subfolder = SUBFOLDER[outputType];
    const subHandle = await _rootHandle.getDirectoryHandle(subfolder, { create: true });
    const fileHandle = await subHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    if (err instanceof Error) {
      // User dismissed the directory picker — do nothing.
      if (err.name === "AbortError") return;

      // If the cached handle is no longer valid (e.g. permissions were revoked),
      // clear it and retry once with a fresh picker prompt.
      if (_rootHandle && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        _rootHandle = null;
        return downloadBrdOutput(blob, filename, outputType);
      }
    }

    // Any other error — fall back to standard browser download.
    console.warn("[brdDownload] File System Access API error, falling back:", err);
    triggerFallbackDownload(blob, filename);
  }
}

/**
 * Clear the cached root directory handle.
 * Call this if you want to force a new folder-picker prompt on the next download.
 */
export function clearBrdOutputRoot(): void {
  _rootHandle = null;
}

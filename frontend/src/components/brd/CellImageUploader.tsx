"use client";
// CellImageUploader.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import api from "@/app/lib/api";
import BrdImage from "./BrdImage";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface UploadedCellImage {
  id: number;
  mediaName: string;
  mimeType: string;
  cellText: string;
  section: string;
  fieldLabel: string;
}

interface Props {
  brdId: string;
  section: string;
  fieldLabel: string;
  existingImages?: UploadedCellImage[];
  onUploaded?: (img: UploadedCellImage) => void;
  onDeleted?: (id: number) => void;
  defaultCellText?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function CellImageUploader({
  brdId,
  section,
  fieldLabel,
  existingImages = [],
  onUploaded,
  onDeleted,
  defaultCellText = "",
}: Props) {
  const inputRef              = useRef<HTMLInputElement>(null);
  const popoverRef            = useRef<HTMLDivElement>(null);
  const buttonRef             = useRef<HTMLButtonElement>(null);
  const [popPos, setPopPos]   = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const [open, setOpen]       = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const normalizedDefaultText = defaultCellText.trim();
  const [captionText, setCaptionText] = useState(normalizedDefaultText);

  const dismiss = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPending(null);
    setOpen(false);
    setError(null);
    setCaptionText(normalizedDefaultText);
  }, [normalizedDefaultText, preview]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        if (!pending) dismiss();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, pending, dismiss]);

  // Cleanup object URL on unmount
  useEffect(() => {
    if (!preview) return;
    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    if (!pending) {
      setCaptionText(normalizedDefaultText);
    }
  }, [normalizedDefaultText, pending]);

  function openPopover(e: React.MouseEvent) {
    e.stopPropagation();
    // Compute smart position before opening
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popW = 224; // w-56 = 14rem = 224px
      const popH = 320; // estimated max height
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceRight = window.innerWidth  - rect.left;
      const pos: { top?: number; bottom?: number; left?: number; right?: number } = {};
      // vertical: open upward if not enough space below
      if (spaceBelow < popH && rect.top > popH) {
        pos.bottom = window.innerHeight - rect.top + 4;
      } else {
        pos.top = rect.bottom + 4;
      }
      // horizontal: open leftward if not enough space to the right
      if (spaceRight < popW && rect.right > popW) {
        pos.right = window.innerWidth - rect.right;
      } else {
        pos.left = rect.left;
      }
      setPopPos(pos);
    }
    setOpen(true);
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Images only (PNG, JPG, WEBP, GIF)."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Max 10 MB."); return; }
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setPending(file);
    setCaptionText(normalizedDefaultText || file.name.replace(/\.[^.]+$/, ""));
    setOpen(true);
  }

  async function handleUpload() {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(pending);
      const res = await api.post<{ success: boolean; image: UploadedCellImage }>(
        `/brd/${brdId}/images/upload`,
        {
          imageData:  base64,
          mimeType:   pending.type,
          mediaName:  pending.name,
          section,
          fieldLabel,
          cellText:   captionText.trim() || normalizedDefaultText || pending.name.replace(/\.[^.]+$/, ""),
        }
      );
      const data = res.data as { success: boolean; image: UploadedCellImage };
      onUploaded?.(data.image);
      dismiss();
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    setError(null);
    try {
      await api.delete(`/brd/${brdId}/images/${id}`);
      onDeleted?.(id);
    } catch {
      setError("Delete failed.");
    } finally {
      setDeleting(null);
    }
  }

  const hasImages = existingImages.length > 0;
  const buttonLabel = hasImages ? `Manage images for ${fieldLabel}` : `Add image to ${fieldLabel}`;

  return (
    <div className="relative flex-shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={pickFile}
      />

      <button
        type="button"
        aria-label={buttonLabel}
        title={buttonLabel}
        ref={buttonRef}
        onClick={openPopover}
        className={[
          "inline-flex items-center justify-center w-6 h-6 rounded-md border transition-all duration-150",
          hasImages
            ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400"
            : "border-slate-200 bg-white text-slate-500 dark:border-[#2a3147] dark:bg-[#161b2e] dark:text-slate-400",
          "hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-600",
        ].join(" ")}
      >
        {hasImages ? (
          <span className="relative inline-flex">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-blue-500 text-white text-[7px] font-bold flex items-center justify-center leading-none">
              {existingImages.length}
            </span>
            <span
              aria-hidden="true"
              className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-full bg-red-500 text-white flex items-center justify-center"
            >
              <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </span>
          </span>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          style={{ position: "fixed", zIndex: 9999, width: 224, ...popPos }}
          className="rounded-xl border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#1e2235] shadow-xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {error && (
            <div className="px-3 py-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-b border-red-100 dark:border-red-700/30 flex items-center justify-between gap-2">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600">x</button>
            </div>
          )}

          {preview && pending && (
            <div className="p-2 space-y-2 border-b border-slate-100 dark:border-[#2a3147]">
              <BrdImage src={preview} alt="preview" className="w-full max-h-28 object-contain rounded bg-slate-50 dark:bg-[#161b2e]" width={224} height={112} />
              <label className="block space-y-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                  Image text
                </span>
                <textarea
                  aria-label="Image text"
                  rows={2}
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  placeholder={normalizedDefaultText || "Optional note or caption"}
                  className="w-full resize-none rounded-md border border-slate-200 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] px-2 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 dark:focus:border-blue-500"
                />
              </label>
              <p className="text-[9px] text-slate-500 dark:text-slate-400">
                Keep the field text and attach or delete images here.
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={dismiss} disabled={uploading}
                  className="flex-1 py-1 rounded text-[10px] font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45] disabled:opacity-50 transition-all">
                  Cancel
                </button>
                <button onClick={handleUpload} disabled={uploading}
                  className="flex-1 py-1 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-all">
                  {uploading ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>
          )}

          {hasImages && (
            <div className="p-2 space-y-2 max-h-56 overflow-y-auto">
              {existingImages.map(img => (
                <div key={img.id} className="rounded-lg overflow-hidden border border-slate-200 dark:border-[#2a3147] bg-slate-50 dark:bg-[#161b2e]">
                  <BrdImage
                    src={buildBrdImageBlobUrl(brdId, img.id, API_BASE)}
                    alt={img.cellText || img.mediaName}
                    className="w-full max-h-32 object-contain"
                    width={224}
                    height={128}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="flex items-center justify-between px-2 py-1 border-t border-slate-100 dark:border-[#2a3147]">
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate flex-1 mr-2">
                      {img.cellText || img.mediaName}
                    </p>
                    <button
                      onClick={() => handleDelete(img.id)}
                      disabled={deleting === img.id}
                      aria-label={`Delete image ${img.cellText || img.mediaName}`}
                      title="Delete image"
                      className="flex-shrink-0 inline-flex items-center justify-center w-6 h-5 rounded bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-700/30 disabled:opacity-40 transition-all"
                    >
                      {deleting === img.id
                        ? <svg className="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.8"/></svg>
                        : <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      }
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex border-t border-slate-100 dark:border-[#2a3147]">
            <button
              onClick={() => inputRef.current?.click()}
              className="flex-1 py-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add image
            </button>
            <button
              onClick={dismiss}
              className="flex-1 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#252d45] border-l border-slate-100 dark:border-[#2a3147] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import type { UploadedCellImage } from "@/components/brd/CellImageUploader";

export interface BrdEditorImageLike {
  id: number;
  mediaName: string;
  mimeType: string;
  cellText: string;
  section?: string;
  fieldLabel?: string;
}

export interface BrdEditorImageMap {
  [key: string]: { id: number }[];
}

export function toUploadedCellImage<T extends BrdEditorImageLike>(image: T): UploadedCellImage {
  return {
    id: image.id,
    mediaName: image.mediaName,
    mimeType: image.mimeType,
    cellText: image.cellText,
    section: image.section ?? "unknown",
    fieldLabel: image.fieldLabel ?? "",
  };
}

export function mergeUploadedImageLists(...lists: Array<ReadonlyArray<BrdEditorImageLike> | undefined>): UploadedCellImage[] {
  const merged = new Map<number, UploadedCellImage>();
  lists.forEach((list) => {
    list?.forEach((image) => {
      merged.set(image.id, toUploadedCellImage(image));
    });
  });
  return Array.from(merged.values());
}

export function removeUploadedImageFromMap<T extends BrdEditorImageMap>(images: T, imageId: number): T {
  const next = Object.fromEntries(
    Object.entries(images)
      .map(([key, value]) => [key, value.filter((image) => image.id !== imageId)])
      .filter(([, value]) => value.length > 0),
  );
  return next as T;
}
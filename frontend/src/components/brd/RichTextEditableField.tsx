import React, { useMemo, useState } from "react";
import { brdRichTextToPlain, sanitizeBrdRichTextHtml, stripLeadingBrdLabel } from "@/utils/brdRichText";

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  labelPrefix?: string;
  inputClassName?: string;
  previewClassName?: string;
}

export default function RichTextEditableField({
  value,
  onChange,
  rows = 3,
  placeholder,
  labelPrefix,
  inputClassName,
  previewClassName,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const normalizedValue = useMemo(() => {
    const raw = value ?? "";
    return labelPrefix ? stripLeadingBrdLabel(raw, labelPrefix) : raw;
  }, [labelPrefix, value]);

  const editorValue = brdRichTextToPlain(normalizedValue);
  const hasValue = editorValue.trim().length > 0;
  const shouldShowEditor = isEditing || (!hasInteracted && !hasValue);

  if (shouldShowEditor) {
    return (
      <div className="space-y-2">
        <textarea
          value={editorValue}
          onChange={(e) => {
            setHasInteracted(true);
            onChange(e.target.value);
          }}
          rows={rows}
          placeholder={placeholder}
          className={inputClassName ?? "w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded px-2 py-1.5 outline-none text-slate-700 dark:text-slate-200 leading-snug"}
        />
        {hasValue && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setHasInteracted(true);
                setIsEditing(false);
              }}
              className="inline-flex items-center rounded-md border border-slate-300 dark:border-[#2a3147] bg-white dark:bg-[#1e2235] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#252d45]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        setHasInteracted(true);
        setIsEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setHasInteracted(true);
          setIsEditing(true);
        }
      }}
      className={previewClassName ?? "min-h-[44px] cursor-text rounded border border-slate-200 dark:border-[#2a3147] bg-slate-50/70 dark:bg-[#161b2e] px-3 py-2 text-[11.5px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words"}
      title="Click to edit"
    >
      <span dangerouslySetInnerHTML={{ __html: sanitizeBrdRichTextHtml(normalizedValue) }} />
    </div>
  );
}

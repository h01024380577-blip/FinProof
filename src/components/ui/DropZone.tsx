"use client";

import { useState, type DragEvent } from "react";
import { Upload, X } from "lucide-react";

export type DropZoneProps = {
  accept: string;
  multiple?: boolean;
  files: File[];
  helperText: string;
  error?: string | null;
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
};

export function DropZone({
  accept,
  multiple = true,
  files,
  helperText,
  error,
  onFilesSelected,
  onRemoveFile
}: DropZoneProps): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length > 0) {
      onFilesSelected(dropped);
    }
  }

  return (
    <div className="dropzone-wrap">
      <label
        className="dropzone"
        data-dragging={isDragging}
        data-has-error={Boolean(error)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload size={26} aria-hidden="true" />
        <strong>{helperText}</strong>
        <span>파일을 끌어다 놓거나 클릭하여 선택</span>
        <input
          aria-label={helperText}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length > 0) {
              onFilesSelected(selected);
            }
          }}
        />
      </label>

      {files.length > 0 ? (
        <ul className="dropzone__file-list" aria-label="선택된 파일">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`${file.name} 제거`}
                onClick={() => onRemoveFile(index)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="dropzone__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

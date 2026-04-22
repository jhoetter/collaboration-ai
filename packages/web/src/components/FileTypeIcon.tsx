/**
 * Coloured glyph for an attachment based on its MIME type.
 *
 * Renders a small rounded square with a 2- to 4-character extension
 * label. Backgrounds use semantic tokens so the icon adapts to light /
 * dark themes; only the accent dot is type-specific.
 */
import { IconCodeBlock, IconFile, IconImage } from "@collabai/ui";

export interface FileTypeIconProps {
  mime: string;
  filename?: string;
  size?: number;
}

interface TypeMeta {
  label: string;
  /** Tailwind class for the background tint. */
  bg: string;
  /** Tailwind class for the foreground text. */
  fg: string;
  icon: "image" | "code" | "file";
}

function classify(mime: string, filename?: string): TypeMeta {
  const m = mime.toLowerCase();
  const ext = (filename?.split(".").pop() ?? "").toLowerCase();
  if (m.startsWith("image/")) {
    return { label: ext.toUpperCase() || "IMG", bg: "bg-violet-500/15", fg: "text-violet-500", icon: "image" };
  }
  if (m === "application/pdf" || ext === "pdf") {
    return { label: "PDF", bg: "bg-red-500/15", fg: "text-red-500", icon: "file" };
  }
  if (
    m.includes("word") ||
    ext === "doc" ||
    ext === "docx" ||
    ext === "rtf"
  ) {
    return { label: "DOC", bg: "bg-blue-500/15", fg: "text-blue-500", icon: "file" };
  }
  if (
    m.includes("sheet") ||
    m.includes("excel") ||
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv"
  ) {
    return {
      label: ext === "csv" ? "CSV" : "XLS",
      bg: "bg-green-500/15",
      fg: "text-green-500",
      icon: "file",
    };
  }
  if (m.includes("presentation") || ext === "ppt" || ext === "pptx") {
    return { label: "PPT", bg: "bg-orange-500/15", fg: "text-orange-500", icon: "file" };
  }
  if (m.startsWith("audio/")) {
    return { label: ext.toUpperCase() || "AUD", bg: "bg-fuchsia-500/15", fg: "text-fuchsia-500", icon: "file" };
  }
  if (m.startsWith("video/")) {
    return { label: ext.toUpperCase() || "VID", bg: "bg-pink-500/15", fg: "text-pink-500", icon: "file" };
  }
  if (m.startsWith("text/") || ext === "md" || ext === "json" || ext === "yaml" || ext === "yml") {
    return {
      label: (ext || "TXT").toUpperCase().slice(0, 4),
      bg: "bg-amber-500/15",
      fg: "text-amber-500",
      icon: "code",
    };
  }
  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "cs",
      "kt",
      "swift",
      "sql",
    ].includes(ext)
  ) {
    return { label: ext.toUpperCase(), bg: "bg-cyan-500/15", fg: "text-cyan-500", icon: "code" };
  }
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) {
    return { label: ext.toUpperCase(), bg: "bg-zinc-500/15", fg: "text-zinc-500", icon: "file" };
  }
  return {
    label: (ext || "FILE").toUpperCase().slice(0, 4),
    bg: "bg-secondary/15",
    fg: "text-secondary",
    icon: "file",
  };
}

export function FileTypeIcon({ mime, filename, size = 40 }: FileTypeIconProps) {
  const meta = classify(mime, filename);
  const Icon = meta.icon === "image" ? IconImage : meta.icon === "code" ? IconCodeBlock : IconFile;
  return (
    <div
      className={`relative flex items-center justify-center rounded-md ${meta.bg} ${meta.fg}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.45)} />
      <span
        className="absolute bottom-1 right-1 rounded bg-card px-1 text-[9px] font-bold leading-none text-secondary shadow-sm"
        style={{ fontSize: Math.max(8, Math.round(size * 0.22)) }}
      >
        {meta.label}
      </span>
    </div>
  );
}

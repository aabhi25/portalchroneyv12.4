import { FileText, Image as ImageIcon, Video, ExternalLink, Phone, Reply, MessageSquare } from "lucide-react";
import { renderBody, type WizardTemplate } from "./types";

/**
 * A WhatsApp-style chat bubble for a template: header (text or image / video /
 * document), body with the sample values filled in, footer, and buttons.
 */
export function WhatsAppMessagePreview({
  template,
  values,
  emptyText = "Choose a template to see the message",
}: {
  template?: WizardTemplate | null;
  values: string[];
  emptyText?: string;
}) {
  if (!template) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl bg-[#e5ddd5] p-4 text-center text-sm text-gray-600">
        <MessageSquare className="h-6 w-6 text-gray-400" />
        {emptyText}
      </div>
    );
  }
  const headerType = (template.headerType || "none").toLowerCase();
  const media = template.headerMediaUrl || "";
  const body = renderBody(template.bodyText, values);
  const parts = body.split(/(\{\{\s*\d+\s*\}\})/g);
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];

  return (
    <div className="rounded-xl bg-[#e5ddd5] p-3 sm:p-4" data-testid="whatsapp-preview">
      <div className="max-w-[95%] sm:max-w-[85%]">
        <div className="overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
          {headerType === "image" && (
            media
              ? <img src={media} alt="Header" className="max-h-48 w-full object-cover" />
              : <MediaPlaceholder icon={<ImageIcon className="h-6 w-6" />} label="Image" />
          )}
          {headerType === "video" && (
            media
              ? <video src={media} className="max-h-48 w-full bg-black object-cover" muted controls preload="metadata" />
              : <MediaPlaceholder icon={<Video className="h-6 w-6" />} label="Video" />
          )}
          {headerType === "document" && (
            <div className="m-2 flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">
              <FileText className="h-5 w-5 shrink-0 text-red-500" />
              <span className="truncate">{media ? decodeURIComponent(media.split("/").pop() || "Document") : "Document"}</span>
            </div>
          )}
          <div className="px-3 pb-1.5 pt-2">
            {headerType === "text" && template.headerText && (
              <p className="mb-1 text-sm font-semibold text-gray-900">{template.headerText}</p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
              {parts.map((part, i) => /^\{\{\s*\d+\s*\}\}$/.test(part)
                ? <span key={i} className="rounded bg-amber-100 px-0.5 font-mono text-amber-800">{part}</span>
                : <span key={i}>{part}</span>)}
            </p>
            {template.footerText && <p className="mt-1 text-xs text-gray-500">{template.footerText}</p>}
            <p className="mt-0.5 text-right text-[10px] text-gray-400">
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
        {buttons.length > 0 && (
          <div className="mt-1 space-y-1">
            {buttons.slice(0, 10).map((b, i) => {
              const type = (b.type || "").toLowerCase();
              const icon = type.includes("url") ? <ExternalLink className="h-3.5 w-3.5" />
                : type.includes("phone") || type.includes("call") ? <Phone className="h-3.5 w-3.5" />
                : <Reply className="h-3.5 w-3.5" />;
              return (
                <div key={i} className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-sm font-medium text-sky-600 shadow-sm">
                  {icon}
                  <span className="truncate">{b.text || "Button"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaPlaceholder({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-gray-200 text-gray-500">
      {icon}
      <span className="text-xs">{label}</span>
    </div>
  );
}

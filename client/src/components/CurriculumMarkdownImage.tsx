import { useEffect, useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";

type CurriculumMarkdownImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string;
};

function proxyUrl(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") return null;
    return `/api/topscholar/media-proxy?url=${encodeURIComponent(source)}`;
  } catch {
    return null;
  }
}

/**
 * Curriculum images are owned by the external content platform. Some of its
 * valid image objects are served as application/octet-stream, which browsers
 * may reject in an <img> request. Keep the source URL as the fast path, then
 * retry once through our MIME-normalizing proxy.
 */
export function CurriculumMarkdownImage({
  src,
  alt,
  onError,
  ...props
}: CurriculumMarkdownImageProps) {
  const directSource = typeof src === "string" ? src : "";
  const [currentSource, setCurrentSource] = useState(directSource);
  const [proxyAttempted, setProxyAttempted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSource(directSource);
    setProxyAttempted(false);
    setFailed(false);
  }, [directSource]);

  if (!currentSource || failed) {
    return (
      <span className="text-sm text-muted-foreground">
        {alt || "Curriculum image"} could not be loaded.
      </span>
    );
  }

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    const fallback = proxyUrl(directSource);
    if (!proxyAttempted && fallback && currentSource !== fallback) {
      setProxyAttempted(true);
      setCurrentSource(fallback);
      return;
    }
    setFailed(true);
    onError?.(event);
  };

  return (
    <img
      {...props}
      src={currentSource}
      alt={alt || "Curriculum image"}
      onError={handleError}
    />
  );
}
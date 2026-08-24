const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isAllowedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host.endsWith(".amazonaws.com") ||
    host.endsWith(".amazonaws.com.cn") ||
    host.endsWith(".cloudfront.net") ||
    host.endsWith(".toppscholars.com")
  );
}

function parseMediaUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid image URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Image URL must be a public HTTPS URL.");
  }
  if (!isAllowedMediaHost(url.hostname)) {
    throw new Error("Image host is not an approved curriculum media host.");
  }
  return url;
}

function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

export async function fetchCurriculumImage(rawUrl: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  let url = parseMediaUrl(rawUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const upstream = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error("Image source redirected too many times.");
      }
      url = parseMediaUrl(new URL(location, url).toString());
      continue;
    }

    if (!upstream.ok) {
      throw new Error(`Image source returned HTTP ${upstream.status}.`);
    }

    const length = Number(upstream.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) throw new Error("Image is too large.");

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_IMAGE_BYTES) throw new Error("Image is too large.");

    const contentType = detectImageType(body);
    if (!contentType) throw new Error("Image source did not return a supported image.");
    return { body, contentType };
  }

  throw new Error("Image source could not be loaded.");
}
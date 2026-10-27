/**
 * Managed media API upload (BitOS media service). Uses the raw POST contract:
 *   Content-Type, X-Upload-Filename, X-SHA-256
 *
 * Multipart is not used because SvelteKit's CSRF protection rejects cross-site
 * form submissions ("Cross-site POST form submissions are forbidden"). The raw
 * body is not a form, so it passes CSRF once the API answers the CORS preflight
 * (the route exports OPTIONS with the required headers).
 */
import { MEDIA_UPLOAD_URL } from "../config.js?v=13";
import { sha256Hex } from "../shared/media.js?v=13";

function endpoint(pubkey) {
  const url = new URL(MEDIA_UPLOAD_URL);
  const clean = String(pubkey || "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(clean)) url.searchParams.set("pubkey", clean);
  url.searchParams.set("purpose", "profile");
  return url.toString();
}

function errorMessage(xhr) {
  try {
    const data = JSON.parse(xhr.responseText || "");
    return data.error || data.message || "";
  } catch {
    return "";
  }
}

export async function uploadToMediaServer(file, pubkey, { onProgress } = {}) {
  if (!file || !file.size) throw new Error("Choose a file to upload.");
  const sha256 = await sha256Hex(file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint(pubkey), true);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.setRequestHeader(
      "X-Upload-Filename",
      encodeURIComponent(file.name || "upload")
    );
    xhr.setRequestHeader("X-SHA-256", sha256);
    xhr.timeout = 300000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText || "");
        } catch {
          /* ignore */
        }
        const url = data && typeof data.url === "string" ? data.url : "";
        if (!/^https:\/\//i.test(url)) {
          reject(new Error("The media server did not return an https URL."));
          return;
        }
        resolve({ url, sha256, provider: "bitos" });
        return;
      }
      const message = errorMessage(xhr);
      reject(new Error(message || `Media server upload failed (${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(new Error("Could not reach the managed media server."));
    xhr.ontimeout = () =>
      reject(new Error("The managed media upload timed out."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));

    xhr.send(file);
  });
}

export async function uploadEntriesToMediaServer(
  entries,
  pubkey,
  { onProgress } = {}
) {
  const results = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const file = entry && entry.file ? entry.file : entry;
    const result = await uploadToMediaServer(file, pubkey, {
      onProgress: (ratio) => {
        if (!onProgress) return;
        try {
          onProgress({
            index,
            ratio,
            total: entries.length,
            label: (entry && entry.label) || "",
          });
        } catch {
          /* ignore */
        }
      },
    });
    results.push(result);
  }
  return results;
}

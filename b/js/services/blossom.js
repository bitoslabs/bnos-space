/**
 * Blossom (BUD-02/BUD-11) uploads. Files are uploaded to the configured
 * Blossom server and only the returned URLs are stored in the portfolio event.
 */
import * as auth from "./auth.js";
import { sha256Hex } from "../shared/media.js?v=13";
import { normalizeBlossomServer } from "../shared/urls.js?v=13";

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function errorMessage(xhr) {
  try {
    const data = JSON.parse(xhr.responseText || "");
    const body = data.message || data.error || data.reason || "";
    if (body) return body;
  } catch {
    /* ignore */
  }
  return xhr.getResponseHeader("X-Reason") || "";
}

async function signUploadToken(entries, base) {
  const createdAt = Math.floor(Date.now() / 1000);
  const unsigned = {
    kind: 24242,
    created_at: createdAt - 5,
    tags: [
      ["t", "upload"],
      ...entries.map((entry) => ["x", entry.sha256]),
      ["expiration", String(createdAt + 600)],
      ["server", new URL(base).hostname],
    ],
    content: "Upload media to Blossom",
  };
  const signed = await auth.signEvent(unsigned);
  if (!signed || !signed.sig) {
    throw new Error("The signer did not approve the upload.");
  }
  return signed;
}

function putBlob(base, file, sha256, signed, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${base}/upload`, true);
    xhr.setRequestHeader(
      "Authorization",
      `Nostr ${toBase64Url(JSON.stringify(signed))}`
    );
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.setRequestHeader("X-SHA-256", sha256);
    xhr.timeout = 180000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let descriptor = null;
        try {
          descriptor = JSON.parse(xhr.responseText || "");
        } catch {
          /* fall through to a plain URL response */
        }
        let url =
          (descriptor && (descriptor.url || descriptor.blob?.url)) || "";
        if (!url) {
          const text = String(xhr.responseText || "").trim();
          if (/^https?:\/\//i.test(text)) url = text;
        }
        if (!url) {
          reject(new Error("The server did not return a file URL."));
          return;
        }
        resolve({ url, sha256 });
        return;
      }
      if (xhr.status === 409) {
        reject(
          new Error(
            "The server rejected the upload because the SHA-256 did not match."
          )
        );
        return;
      }
      const message = errorMessage(xhr);
      reject(new Error(message || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(
        new Error("Upload failed. Check the Blossom server URL and CORS.")
      );
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));

    xhr.send(file);
  });
}

/**
 * Upload several files with one signed authorization token. BUD-11 permits
 * multiple `x` tags, which lets a video and its generated poster share one
 * signer approval.
 */
export async function uploadFilesToBlossom(
  entries,
  server,
  { onProgress } = {}
) {
  const base = normalizeBlossomServer(server);
  if (!base) throw new Error("Enter a valid Blossom server URL.");
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error("Choose a file to upload.");
  }

  const prepared = [];
  for (const entry of entries) {
    const file = entry && entry.file ? entry.file : entry;
    if (!file || !file.size) throw new Error("Choose a file to upload.");
    prepared.push({
      file,
      sha256: await sha256Hex(file),
      label: (entry && entry.label) || "",
    });
  }

  const signed = await signUploadToken(prepared, base);
  const results = [];

  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    const result = await putBlob(
      base,
      item.file,
      item.sha256,
      signed,
      (ratio) => {
        if (!onProgress) return;
        try {
          onProgress({
            index,
            ratio,
            total: prepared.length,
            label: item.label,
          });
        } catch {
          /* progress reporting must not break the upload */
        }
      }
    );
    results.push(result);
  }

  return results;
}

export async function uploadToBlossom(file, server, { onProgress } = {}) {
  const [result] = await uploadFilesToBlossom([{ file }], server, {
    onProgress: ({ ratio }) => {
      if (onProgress) onProgress(ratio);
    },
  });
  return result;
}

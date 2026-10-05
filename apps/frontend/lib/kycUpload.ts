/**
 * Imperative KYC document upload used by the merchant registration flow
 * (the `useKycUpload` hook is the React-facing wrapper over the same
 * encryption + multipart upload).
 *
 * The document never leaves the browser in the clear: it is encrypted with a
 * fresh AES-256-GCM key, and that key is wrapped with the gateway's RSA-OAEP
 * public key before the ciphertext is POSTed.
 */
import { encryptDocument } from "../hooks/useKycUpload";
import type { KycDocumentType } from "../hooks/useKycUpload";
import type { KycVerificationStatus } from "../hooks/useKycStatus";

export type { KycDocumentType } from "../hooks/useKycUpload";
export type { KycVerificationStatus } from "../hooks/useKycStatus";

export interface EncryptedKycDocument {
  /** Ciphertext plus its wrapped-key header. */
  blob: Blob;
  /** Identifier of the wrapped AES key. */
  keyId: string;
  /** Base64 initialisation vector used for the AES-GCM payload. */
  ivBase64: string;
}

export interface KycUploadRequest {
  documentType: KycDocumentType;
  encryptedFileBlob: Blob;
  merchantId: string;
}

export interface KycUploadOptions {
  /** Progress callback, 0–100. */
  onProgress?: (percent: number) => void;
  /** Address the upload is attributed to; forwarded as a request header. */
  signerAddress?: string;
  apiBaseUrl?: string;
  signal?: AbortSignal;
}

export interface KycUploadResponse {
  uploadId: string;
  status: KycVerificationStatus;
  uploadedAt: string;
}

export interface PollKycOptions {
  signerAddress?: string;
  signal?: AbortSignal;
  onStatus?: (status: KycVerificationStatus) => void;
  apiBaseUrl?: string;
}

const DEFAULT_API_BASE_URL = "/api";

function gatewayBase(apiBaseUrl?: string): string {
  return apiBaseUrl ?? DEFAULT_API_BASE_URL;
}

async function fetchGatewayPublicKey(apiBaseUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(`${apiBaseUrl}/kyc/encryption-key`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Unable to fetch the gateway encryption key.");
  }
  const json = (await response.json()) as { publicKey?: string };
  if (!json.publicKey) {
    throw new Error("Gateway returned an invalid encryption key.");
  }
  const binary = atob(json.publicKey);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Encrypts `file` for the gateway; never transmits anything itself. */
export async function encryptKycDocument(
  file: Blob,
  apiBaseUrl?: string,
): Promise<EncryptedKycDocument> {
  const publicKey = await fetchGatewayPublicKey(gatewayBase(apiBaseUrl));
  return encryptDocument(file, publicKey);
}

/** POSTs an already-encrypted document to the gateway's KYC endpoint. */
export function uploadKycDocument(
  request: KycUploadRequest,
  options: KycUploadOptions = {},
): Promise<KycUploadResponse> {
  const { onProgress, signerAddress, apiBaseUrl, signal } = options;

  const form = new FormData();
  form.append("merchantId", request.merchantId);
  form.append("documentType", request.documentType);
  form.append("file", request.encryptedFileBlob, `${request.documentType}.enc`);

  return new Promise<KycUploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${gatewayBase(apiBaseUrl)}/kyc/documents`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    if (signerAddress) {
      xhr.setRequestHeader("X-Signer-Address", signerAddress);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as KycUploadResponse | null;
        if (!body?.uploadId) {
          reject(new Error("Gateway returned an invalid KYC upload response."));
          return;
        }
        resolve(body);
      } else {
        const message =
          (xhr.response as { error?: string } | null)?.error ??
          `KYC upload failed with status ${xhr.status}.`;
        reject(new Error(message));
      }
    };

    xhr.onerror = () =>
      reject(new Error("Network error while uploading the KYC document."));
    xhr.onabort = () =>
      reject(new DOMException("KYC upload aborted.", "AbortError"));

    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/**
 * Polls the gateway until the document leaves the `pending` state, reporting
 * every transition through `onStatus`. Resolves with the final state.
 */
export async function pollKycVerificationStatus(
  uploadId: string,
  options: PollKycOptions = {},
): Promise<KycUploadResponse> {
  const { signerAddress, signal, onStatus, apiBaseUrl } = options;
  const intervalMs = 5000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("KYC status polling aborted.", "AbortError");
    }

    const response = await fetch(
      `${gatewayBase(apiBaseUrl)}/kyc/documents/${encodeURIComponent(uploadId)}`,
      {
        method: "GET",
        credentials: "include",
        headers: signerAddress ? { "X-Signer-Address": signerAddress } : {},
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `Unable to read KYC verification status (status ${response.status}).`,
      );
    }

    const body = (await response.json()) as KycUploadResponse;
    onStatus?.(body.status);
    if (body.status !== "pending") {
      return body;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
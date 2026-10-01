import { Readable } from 'stream';

/**
 * Storage abstraction. Every provider (MinIO, S3, Azure Blob) implements
 * this interface so the rest of the app never depends on a specific SDK.
 * Objects stored here are ALREADY client-side encrypted ciphertext — this
 * layer has no knowledge of plaintext file content.
 */
export interface StoredObjectMeta {
  key: string;
  sizeBytes: number;
  etag?: string;
}

export interface StorageProvider {
  /** Upload an already-encrypted object. */
  putObject(key: string, body: Buffer | Readable, contentLength: number): Promise<StoredObjectMeta>;

  /** Retrieve an encrypted object as a stream (for large-file streaming downloads). */
  getObjectStream(key: string): Promise<Readable>;

  deleteObject(key: string): Promise<void>;

  /** Generate a short-lived presigned URL, only ever issued after zero-trust authorization checks. */
  getPresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  getPresignedUploadUrl(key: string, expiresInSeconds: number): Promise<string>;

  objectExists(key: string): Promise<boolean>;
}

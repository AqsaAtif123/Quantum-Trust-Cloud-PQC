import AWS from 'aws-sdk';
import { Readable } from 'stream';
import { StorageProvider, StoredObjectMeta } from './StorageProvider';
import { env } from '../../config/env';

/**
 * Works against both real AWS S3 and MinIO (self-hosted, S3-compatible),
 * since MinIO implements the S3 API. Local dev points STORAGE_ENDPOINT at
 * the MinIO container; production points at real S3 with no endpoint override.
 */
export class S3CompatibleProvider implements StorageProvider {
  private readonly s3: AWS.S3;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.STORAGE_BUCKET;
    this.s3 = new AWS.S3({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY,
      secretAccessKey: env.STORAGE_SECRET_KEY,
      s3ForcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      signatureVersion: 'v4',
    });
  }

  async putObject(key: string, body: Buffer | Readable, contentLength: number): Promise<StoredObjectMeta> {
    const result = await this.s3
      .putObject({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        // Server-side encryption at rest as defense-in-depth, on top of
        // client-side encryption. This does NOT replace client-side
        // encryption — it's a second layer, not a substitute.
        ServerSideEncryption: 'AES256',
      })
      .promise();

    return { key, sizeBytes: contentLength, etag: result.ETag };
  }

  async getObjectStream(key: string): Promise<Readable> {
    const stream = this.s3
      .getObject({ Bucket: this.bucket, Key: key })
      .createReadStream();
    return stream;
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.deleteObject({ Bucket: this.bucket, Key: key }).promise();
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresInSeconds,
    });
  }

  async getPresignedUploadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.s3.getSignedUrlPromise('putObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresInSeconds,
    });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.headObject({ Bucket: this.bucket, Key: key }).promise();
      return true;
    } catch (err: any) {
      if (err.code === 'NotFound' || err.statusCode === 404) return false;
      throw err;
    }
  }
}

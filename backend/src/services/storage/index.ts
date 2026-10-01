import { StorageProvider } from './StorageProvider';
import { S3CompatibleProvider } from './S3CompatibleProvider';
import { env } from '../../config/env';

let cachedProvider: StorageProvider | null = null;

/**
 * MinIO and S3 both speak the S3 API, so they share one implementation.
 * Azure Blob would get its own class implementing the same interface;
 * everything else in the app is unaffected by which one is active.
 */
export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;

  switch (env.STORAGE_PROVIDER) {
    case 'minio':
    case 's3':
      cachedProvider = new S3CompatibleProvider();
      break;
    case 'azure':
      throw new Error(
        'Azure Blob provider not yet wired up — implement AzureBlobProvider against the StorageProvider interface and register it here.',
      );
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER}`);
  }
  return cachedProvider;
}

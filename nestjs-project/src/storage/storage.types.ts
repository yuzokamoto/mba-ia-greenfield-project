export interface MultipartReference {
  key: string;
  uploadId: string;
}

export interface StoragePart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface SignedStorageUrl {
  url: string;
  expiresAt: Date;
  headers: Record<string, string>;
}

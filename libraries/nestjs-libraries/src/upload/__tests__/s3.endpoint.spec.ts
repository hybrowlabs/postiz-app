jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    middlewareStack: { add: jest.fn() },
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  UploadPartCommand: jest.fn(),
  ListPartsCommand: jest.fn(),
  CreateMultipartUploadCommand: jest.fn(),
  CompleteMultipartUploadCommand: jest.fn(),
  AbortMultipartUploadCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }));
jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), {
  virtual: true,
});
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator',
  () => ({
    isSafePublicHttpsUrl: jest.fn(),
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({
    ssrfSafeDispatcher: {},
  })
);

const WASABI = 'https://s3.us-central-1.wasabisys.com';
const ENV_KEYS = [
  'STORAGE_PROVIDER',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_ACCESS_KEY',
  'CLOUDFLARE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_REGION',
  'CLOUDFLARE_BUCKETNAME',
  'CLOUDFLARE_BUCKET_URL',
  'CLOUDFLARE_ENDPOINT',
];

const clientConfig = () => {
  const { S3Client } = require('@aws-sdk/client-s3');
  const calls = (S3Client as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

describe('S3 endpoint override for cloudflare storage provider', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.resetModules();
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    process.env.STORAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct123';
    process.env.CLOUDFLARE_ACCESS_KEY = 'ak';
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY = 'sk';
    process.env.CLOUDFLARE_REGION = 'us-central-1';
    process.env.CLOUDFLARE_BUCKETNAME = 'bucket';
    process.env.CLOUDFLARE_BUCKET_URL = 'https://media.example.com';
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('UploadFactory.createStorage', () => {
    it('uses the R2 endpoint and no path style when CLOUDFLARE_ENDPOINT is unset', () => {
      const { UploadFactory } = require('../upload.factory');
      UploadFactory.createStorage();
      const cfg = clientConfig();
      expect(cfg.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
      expect(cfg.forcePathStyle).toBeUndefined();
      expect(cfg.region).toBe('us-central-1');
    });

    it('uses the R2 endpoint when CLOUDFLARE_ENDPOINT is an empty string', () => {
      process.env.CLOUDFLARE_ENDPOINT = '';
      const { UploadFactory } = require('../upload.factory');
      UploadFactory.createStorage();
      const cfg = clientConfig();
      expect(cfg.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
      expect(cfg.forcePathStyle).toBeUndefined();
    });

    it('uses the custom endpoint with path style when CLOUDFLARE_ENDPOINT is set', () => {
      process.env.CLOUDFLARE_ENDPOINT = WASABI;
      const { UploadFactory } = require('../upload.factory');
      UploadFactory.createStorage();
      const cfg = clientConfig();
      expect(cfg.endpoint).toBe(WASABI);
      expect(cfg.forcePathStyle).toBe(true);
      expect(cfg.region).toBe('us-central-1');
      expect(cfg.credentials).toEqual({
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
      });
    });
  });

  describe('r2.uploader (browser multipart path)', () => {
    it('uses the R2 endpoint when CLOUDFLARE_ENDPOINT is unset', () => {
      require('../r2.uploader');
      const cfg = clientConfig();
      expect(cfg.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
      expect(cfg.forcePathStyle).toBeUndefined();
      expect(cfg.region).toBe('auto');
    });

    it('uses the custom endpoint with path style when CLOUDFLARE_ENDPOINT is set', () => {
      process.env.CLOUDFLARE_ENDPOINT = WASABI;
      require('../r2.uploader');
      const cfg = clientConfig();
      expect(cfg.endpoint).toBe(WASABI);
      expect(cfg.forcePathStyle).toBe(true);
    });

    it('signs for CLOUDFLARE_REGION when a custom endpoint is set', () => {
      process.env.CLOUDFLARE_ENDPOINT = WASABI;
      require('../r2.uploader');
      expect(clientConfig().region).toBe('us-central-1');
    });

    it('keeps region auto for a custom endpoint when CLOUDFLARE_REGION is unset', () => {
      process.env.CLOUDFLARE_ENDPOINT = WASABI;
      delete process.env.CLOUDFLARE_REGION;
      require('../r2.uploader');
      expect(clientConfig().region).toBe('auto');
    });
  });
});

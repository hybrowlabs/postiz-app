jest.mock('../../database/prisma/prisma.service', () => ({ PrismaRepository: class {} }));
import { MediaRepository } from '../../database/prisma/media/media.repository';
import { PrivateMediaAccess } from '../private.media.access';

// A provider avatar has no Media row. It must still be readable only through
// an active Integration belonging to the requesting organization.
describe('private integration avatars', () => {
  const saved = { ...process.env };
  const path = 'https://bucket.example/avatar.jpeg';
  let deletedAt: Date | null;
  let avatarPath: string;
  let access: PrivateMediaAccess;
  const signDownloadUrl = jest.fn(async () => 'signed-avatar');
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 'cloudflare';
    process.env.STORAGE_PRIVATE = 'true';
    process.env.CLOUDFLARE_BUCKET_URL = 'https://bucket.example';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example/api';
    deletedAt = null;
    avatarPath = path;
    signDownloadUrl.mockClear();
    const repository = new MediaRepository({ model: {
      media: { findFirst: jest.fn(async () => null) },
      integration: { findFirst: jest.fn(async ({ where }: any) =>
        where.organizationId === 'owner' && where.picture.in.includes(avatarPath) &&
        where.deletedAt === deletedAt ? { id: 'integration', picture: avatarPath } : null),
      },
    }} as any);
    access = new PrivateMediaAccess(repository, { signDownloadUrl });
  });
  afterAll(() => { process.env = saved; });
  it('renders an active owned avatar without requiring a Media record', async () => {
    expect(await access.download('owner', 'avatar.jpeg')).toBe('signed-avatar');
  });
  it('authorizes an owned legacy avatar stored with a duplicate slash', async () => {
    avatarPath = 'https://bucket.example//avatar.jpeg';
    expect(await access.download('owner', 'avatar.jpeg')).toBe('signed-avatar');
    await expect(access.download('other', 'avatar.jpeg')).rejects.toThrow('Media not found');
  });
  it('denies other organizations and deleted integrations', async () => {
    await expect(access.download('other', 'avatar.jpeg')).rejects.toThrow('Media not found');
    deletedAt = new Date();
    await expect(access.download('owner', 'avatar.jpeg')).rejects.toThrow('Media not found');
    expect(signDownloadUrl).not.toHaveBeenCalled();
  });
});

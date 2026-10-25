import { ConfigService } from '@nestjs/config';
import { VideoCheckUnavailableException } from '../common/api.exception';
import { YouTubeVideoChecker, problemOf } from './youtube-video-checker';

const ID = 'dQw4w9WgXcQ';

describe('problemOf (reading a videos.list status)', () => {
  it.each([
    ['an Unlisted video', { uploadStatus: 'processed', privacyStatus: 'unlisted', embeddable: true }, null],
    ['a Public video', { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true }, null],
    ['no such video', undefined, 'NOT_FOUND'],
    ['a deleted upload', { uploadStatus: 'deleted', privacyStatus: 'unlisted', embeddable: true }, 'NOT_FOUND'],
    ['a rejected upload', { uploadStatus: 'rejected', privacyStatus: 'unlisted', embeddable: true }, 'NOT_FOUND'],
    ['a Private video', { uploadStatus: 'processed', privacyStatus: 'private', embeddable: true }, 'PRIVATE'],
    ['one still processing', { uploadStatus: 'uploaded', privacyStatus: 'unlisted', embeddable: true }, 'NOT_READY'],
    ['embedding turned off', { uploadStatus: 'processed', privacyStatus: 'unlisted', embeddable: false }, 'NOT_EMBEDDABLE'],
  ])('%s', (_, status, expected) => {
    expect(problemOf(status)).toBe(expected);
  });
});

describe('YouTubeVideoChecker', () => {
  const checker = (key: string | undefined) =>
    new YouTubeVideoChecker({ get: () => key } as unknown as ConfigService);
  const fetchMock = jest.spyOn(global, 'fetch');

  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('asks videos.list for the status of that one video', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ items: [{ status: { uploadStatus: 'processed', privacyStatus: 'unlisted', embeddable: true } }] }),
    );

    await expect(checker('key-1').check(ID)).resolves.toBeNull();

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(Object.fromEntries(url.searchParams)).toEqual({ part: 'status', id: ID, key: 'key-1' });
  });

  it('reads an empty answer as no such video', async () => {
    fetchMock.mockResolvedValue(Response.json({ items: [] }));
    await expect(checker('key-1').check(ID)).resolves.toBe('NOT_FOUND');
  });

  it('gives a retryable error when YouTube refuses (bad key, no quota) or cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quotaExceeded', { status: 403 }));
    await expect(checker('key-1').check(ID)).rejects.toBeInstanceOf(VideoCheckUnavailableException);

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(checker('key-1').check(ID)).rejects.toBeInstanceOf(VideoCheckUnavailableException);
  });

  it('fails the boot when no API key is set', () => {
    expect(() => checker(undefined).assertConfigured()).toThrow(/YOUTUBE_API_KEY/);
    expect(() => checker('key-1').assertConfigured()).not.toThrow();
  });
});

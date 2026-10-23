import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoCheckUnavailableException } from '../common/api.exception';
import { VIDEO_PROBLEMS, VideoChecker, VideoProblem } from './video-checker';

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const TIMEOUT_MS = 5_000;

/** The part of a videos.list item this reads. */
interface VideoStatus {
  uploadStatus?: string;
  privacyStatus?: string;
  embeddable?: boolean;
}

/**
 * Asks the YouTube Data API (videos.list, part=status) whether a video will
 * play for patients. One call costs 1 unit of the 10,000 a day YouTube gives
 * a project for free, and it only runs when an admin saves a video link.
 *
 * The clinic uploads its videos as Unlisted. Public videos play too, so they
 * are accepted; Private ones only play for invited Google accounts.
 *
 * The key is read on first use so that tests and tooling don't need one;
 * `assertConfigured` in main.ts fails the boot when it is missing in a real run.
 */
@Injectable()
export class YouTubeVideoChecker implements VideoChecker {
  private readonly logger = new Logger(YouTubeVideoChecker.name);

  constructor(private readonly config: ConfigService) {}

  async check(videoId: string): Promise<VideoProblem | null> {
    const url = new URL(VIDEOS_ENDPOINT);
    url.searchParams.set('part', 'status');
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', this.apiKey());

    let items: { status?: VideoStatus }[];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        // A bad key or a used-up daily quota both land here (400 / 403).
        throw new Error(`YouTube answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      items = ((await res.json()) as { items?: { status?: VideoStatus }[] }).items ?? [];
    } catch (error) {
      this.logger.error(`Video check for ${videoId} failed: ${(error as Error).message}`);
      throw new VideoCheckUnavailableException();
    }

    return problemOf(items[0]?.status);
  }

  assertConfigured(): void {
    this.apiKey();
  }

  private apiKey(): string {
    const key = this.config.get<string>('YOUTUBE_API_KEY');
    if (!key) {
      throw new Error(
        'YOUTUBE_API_KEY missing. It is a Google Cloud API key with the YouTube Data API v3 ' +
          'enabled, used to check that exercise videos play for patients.',
      );
    }
    return key;
  }
}

/** Exported for the unit test. */
export function problemOf(status: VideoStatus | undefined): VideoProblem | null {
  if (!status) return VIDEO_PROBLEMS.NOT_FOUND;
  // deleted, failed and rejected uploads never play.
  if (status.uploadStatus && !['processed', 'uploaded'].includes(status.uploadStatus)) return VIDEO_PROBLEMS.NOT_FOUND;
  if (status.privacyStatus === 'private') return VIDEO_PROBLEMS.PRIVATE;
  if (status.uploadStatus === 'uploaded') return VIDEO_PROBLEMS.NOT_READY;
  if (status.embeddable === false) return VIDEO_PROBLEMS.NOT_EMBEDDABLE;
  return null;
}

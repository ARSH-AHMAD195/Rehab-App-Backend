/**
 * Why a video can't be used. Patients play it inside the app, so it must
 * exist, be watchable by anyone with the link (Unlisted, or Public) and allow
 * playing outside YouTube.
 */
export const VIDEO_PROBLEMS = {
  NOT_FOUND: 'NOT_FOUND',
  PRIVATE: 'PRIVATE',
  NOT_READY: 'NOT_READY',
  NOT_EMBEDDABLE: 'NOT_EMBEDDABLE',
} as const;
export type VideoProblem = (typeof VIDEO_PROBLEMS)[keyof typeof VIDEO_PROBLEMS];

/** What the admin is told, as `details[].issue`. */
export const VIDEO_PROBLEM_ISSUES: Record<VideoProblem, string> = {
  NOT_FOUND: 'no YouTube video with this id - it may have been deleted',
  PRIVATE: 'the video is Private, so patients cannot play it - set it to Unlisted in YouTube Studio',
  NOT_READY: 'YouTube is still processing the video - try again when it has finished',
  NOT_EMBEDDABLE: 'the video does not allow embedding, so it cannot play in the app - turn on "Allow embedding" in YouTube Studio',
};

export interface VideoChecker {
  /** null when the video plays for patients; otherwise why not. */
  check(videoId: string): Promise<VideoProblem | null>;
}

/**
 * Injection token. Production binds the YouTube Data API checker; tests bind
 * a stub so they never call YouTube.
 */
export const VIDEO_CHECKER = Symbol('VIDEO_CHECKER');

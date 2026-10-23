import { parseYouTubeVideoId, youTubeWatchUrl } from './youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeVideoId', () => {
  it.each([
    [ID],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abcdef`],
    [`youtu.be/${ID}`],
    [`www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}?rel=0`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`  https://youtu.be/${ID}  `],
  ])('reads the id from %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID);
  });

  it.each([
    [''],
    ['not a link'],
    ['dQw4w9WgXc'], // 10 characters
    ['https://www.youtube.com/playlist?list=PL123'],
    ['https://www.youtube.com/@SomeChannel'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/watch?v=short'],
    [`https://vimeo.com/${ID}`],
    [`https://youtube.com.evil.example/watch?v=${ID}`],
    [`ftp://youtu.be/${ID}`],
    [`javascript:alert(1)//youtu.be/${ID}`],
  ])('refuses %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});

describe('youTubeWatchUrl', () => {
  it('builds a plain watch link', () => {
    expect(youTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

import { AIML_PLACEHOLDERS } from '@/lib/aiml'

import { AimlYoutubeVideo } from './aiml-youtube-video'

export function BeforeAfterVideo() {
  const { videoId, videoTitle } = AIML_PLACEHOLDERS.beforeAfter
  return <AimlYoutubeVideo videoId={videoId} videoTitle={videoTitle} />
}

function PlayOverlay({ label }: { label: string }) {
  return (
    <button
      type="button"
      data-aiml-play
      aria-label={label}
      className="group absolute inset-0 block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
    >
      <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/40" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="relative flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36">
          <span className="aiml-play-ring absolute inset-0 rounded-full bg-red-600/35" aria-hidden />
          <span className="aiml-play-ring-delay absolute inset-0 rounded-full bg-red-600/25" aria-hidden />
          <span
            className="aiml-play-pulse relative flex h-24 w-24 items-center justify-center rounded-full bg-[#ff0000] shadow-[0_10px_40px_rgba(255,0,0,0.55)] transition-transform group-hover:scale-105 sm:h-32 sm:w-32"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="ml-1.5 h-12 w-12 fill-white sm:h-16 sm:w-16" aria-hidden>
              <path d="M8 5.14v13.72L19.5 12 8 5.14z" />
            </svg>
          </span>
        </span>
      </span>
    </button>
  )
}

const frameClassName = 'overflow-hidden rounded-2xl border border-gray-200 bg-black shadow-sm'
const boxClassName = 'relative aspect-video min-h-56 w-full'

export function AimlYoutubeVideo({
  videoId,
  videoTitle,
}: {
  videoId: string
  videoTitle: string
}) {
  return (
    <figure data-aiml-player="" data-youtube={videoId} className={frameClassName}>
      <div data-aiml-frame="" className={boxClassName}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <PlayOverlay label={`Play video: ${videoTitle}`} />
      </div>
    </figure>
  )
}

export function AimlFileVideo({
  src,
  title,
}: {
  src: string
  title: string
}) {
  return (
    <figure className={frameClassName}>
      <div className={boxClassName}>
        <video
          data-aiml-loop
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label={title}
        >
          <source src={src} type="video/mp4" />
        </video>
      </div>
    </figure>
  )
}

export function AimlPlayerScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){
  if (!window.__aimlPlayBound) {
    window.__aimlPlayBound = true;
    document.addEventListener('click', function(event) {
      var btn = event.target && event.target.closest ? event.target.closest('[data-aiml-play]') : null;
      if (!btn) return;
      event.preventDefault();
      var player = btn.closest('[data-aiml-player]');
      if (!player) return;
      var youtube = player.getAttribute('data-youtube');
      var frame = player.querySelector('[data-aiml-frame]');
      if (youtube && frame) {
        var title = (btn.getAttribute('aria-label') || 'Video').replace(/"/g, '');
        frame.innerHTML = '<iframe title="' + title + '" src="https://www.youtube-nocookie.com/embed/' + youtube + '?autoplay=1&rel=0&modestbranding=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen class="absolute inset-0 h-full w-full"></iframe>';
      }
    });
  }
  function playLoop(video) {
    video.muted = true;
    var playPromise = video.play();
    if (playPromise && playPromise.catch) playPromise.catch(function(){});
  }
  function bindLoopVideos() {
    var videos = document.querySelectorAll('video[data-aiml-loop]');
    if (!videos.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.__aimlLoopObserver && 'IntersectionObserver' in window) {
      window.__aimlLoopObserver = new IntersectionObserver(function(entries) {
        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          if (entry.isIntersecting) playLoop(entry.target);
          else entry.target.pause();
        }
      }, { threshold: 0.25, rootMargin: '80px 0px' });
    }
    for (var k = 0; k < videos.length; k++) {
      var video = videos[k];
      if (video.dataset.aimlLoopBound) continue;
      video.dataset.aimlLoopBound = '1';
      if (window.__aimlLoopObserver) window.__aimlLoopObserver.observe(video);
      else playLoop(video);
    }
  }
  bindLoopVideos();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindLoopVideos);
})();`,
      }}
    />
  )
}

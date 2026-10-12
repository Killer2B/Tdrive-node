import React, { useRef, useState } from 'react';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

/** مشغّل HTML5 أنيق بسيط: بوستر + زرّ تشغيل كبير، ثم عناصر تحكّم أصلية + حالات تحميل/خطأ. */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, poster, className }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const play = () => {
    setStarted(true);
    setLoading(true);
    ref.current?.play().catch(() => setError(true));
  };

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-black border border-white/10 shadow-lg group ${className ?? ''}`}
    >
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls={started}
        preload="metadata"
        playsInline
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onError={() => {
          setError(true);
          setLoading(false);
        }}
        className="w-full aspect-video max-h-[70vh] object-contain bg-black"
      />

      {!started && !error && (
        <button
          type="button"
          onClick={play}
          aria-label="تشغيل"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-t from-black/70 via-black/10 to-black/30 text-white"
        >
          <span className="w-16 h-16 rounded-full bg-primary-container/90 text-on-primary-container flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-4xl">play_arrow</span>
          </span>
          <span className="font-mono text-xs text-white/80">تشغيل</span>
        </button>
      )}

      {loading && started && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined animate-spin text-3xl text-white/90">progress_activity</span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-container-lowest text-error">
          <span className="material-symbols-outlined text-3xl">error</span>
          <span className="text-xs">تعذّر تشغيل الفيديو</span>
        </div>
      )}
    </div>
  );
};

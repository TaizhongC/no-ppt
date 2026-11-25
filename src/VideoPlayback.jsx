import React, { useEffect, useRef, useState } from 'react'
import { ExternalLink, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { loadYouTubeAPI } from './youtube'

function usePlaybackIntent(active, hovered) {
  const [override, setOverride] = useState(null)
  useEffect(() => { setOverride(null) }, [active, hovered])
  return [active && (override ?? hovered), setOverride]
}

function VideoControls({ playing, muted, duration, time, play, pause, reset, seek, toggleMute, children, disabled = false }) {
  const Toggle = playing ? Pause : Play
  const Volume = muted ? VolumeX : Volume2
  return <div className="video-controls" onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} title={playing ? 'Pause' : 'Play'}
      disabled={disabled} onClick={playing ? pause : play}><Toggle /></button>
    <button type="button" aria-label="Reset video" title="Reset video" disabled={disabled} onClick={reset}><RotateCcw /></button>
    <input type="range" aria-label="Video position" min={0} max={duration || 1} step={0.1}
      value={Math.min(time, duration || 0)} disabled={!duration || disabled}
      onChange={event => seek(event.target.valueAsNumber)} />
    <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} title={muted ? 'Unmute' : 'Mute'}
      disabled={disabled} onClick={toggleMute}><Volume /></button>
    {children}
  </div>
}

export function FileVideo({ src, poster, style, mode, active, hovered, onError }) {
  const video = useRef(null)
  const [intent, setIntent] = usePlaybackIntent(active, hovered)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const editing = mode === 'edit'
  const shouldPlay = editing ? intent : active

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (shouldPlay) {
      element.play().catch(error => {
        if (!editing && error.name === 'NotAllowedError') setBlocked(true)
      })
    } else element.pause()
  }, [shouldPlay, editing, src])

  function seek(seconds) {
    video.current.currentTime = seconds
    setTime(seconds)
  }

  function pause() {
    setIntent(false)
    video.current.pause()
  }

  return <div className="file-video">
    <video ref={video} src={src} poster={poster || undefined} style={style} muted={editing && muted} playsInline
      preload={!editing && active ? 'auto' : 'metadata'} loop={!editing}
      onPlay={editing ? () => setPlaying(true) : () => setBlocked(false)}
      onPause={editing ? () => setPlaying(false) : undefined}
      onEnded={editing ? () => setPlaying(false) : undefined}
      onDurationChange={editing ? event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0) : undefined}
      onTimeUpdate={editing ? event => setTime(event.currentTarget.currentTime) : undefined}
      onError={onError} />
    {!editing && active && blocked && <button type="button" className="file-video-play"
      onClick={() => video.current.play().catch(() => {})}><Play fill="currentColor" /> Play with sound</button>}
    {editing && <VideoControls playing={playing} muted={muted} duration={duration} time={time}
      play={() => { setIntent(true); video.current.play().catch(() => {}) }}
      pause={pause} reset={() => { pause(); seek(0) }} seek={seek}
      toggleMute={() => setMuted(previous => !previous)} />}
  </div>
}

export function YouTubeMedia({ video, mode, active, hovered, autoplay }) {
  const surface = useRef(null)
  const player = useRef(null)
  const [intent, setIntent] = usePlaybackIntent(active, hovered)
  const [visible, setVisible] = useState(false)
  const [requested, setRequested] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const interactive = mode !== 'thumb'
  const editing = mode === 'edit'
  const shouldPlay = active && (autoplay || intent)
  const watchLink = <a className="youtube-link" href={video.watch} target="_blank" rel="noopener noreferrer"
    aria-label="Open on YouTube" title="Open on YouTube"><ExternalLink /></a>

  useEffect(() => {
    if (!interactive) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio > 0.5), { threshold: [0, .5, .51] })
    observer.observe(surface.current)
    return () => observer.disconnect()
  }, [interactive])

  function hasSpace() {
    return surface.current?.clientWidth >= 200 && surface.current.clientHeight >= 200
  }

  useEffect(() => {
    if (interactive && shouldPlay && visible && hasSpace()) setRequested(true)
    if (!active) setRequested(false)
  }, [interactive, shouldPlay, visible, active])

  useEffect(() => {
    if (!interactive || !requested || !active || failed) return
    let dispose = false
    let instance
    const mount = surface.current.querySelector('.youtube-host')
    function sample() {
      if (dispose) return
      setTime(instance?.getCurrentTime?.() || 0)
      const length = instance?.getDuration?.()
      setDuration(Number.isFinite(length) ? length : 0)
      const muted = instance?.isMuted?.()
      if (typeof muted === 'boolean') setMuted(muted)
    }
    loadYouTubeAPI().then(YT => {
      if (dispose) return
      const iframe = document.createElement('iframe')
      const src = new URL(video.embed)
      src.searchParams.set('enablejsapi', '1')
      src.searchParams.set('origin', window.location.origin)
      src.searchParams.set('controls', '1')
      iframe.title = 'YouTube video player'
      iframe.src = src.href
      iframe.referrerPolicy = 'strict-origin-when-cross-origin'
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
      iframe.allowFullscreen = true
      mount.replaceChildren(iframe)
      instance = new YT.Player(iframe, { events: {
        onReady: event => {
          if (dispose) return
          player.current = event.target
          if (editing) event.target.mute()
          else event.target.unMute()
          setReady(true)
          if (editing) sample()
        },
        onStateChange: event => {
          if (dispose) return
          if (editing) {
            setPlaying(event.data === 1)
            sample()
          }
        },
        onError: () => { if (!dispose) setFailed(true) },
      } })
    }).catch(() => { if (!dispose) setFailed(true) })
    const timer = editing ? window.setInterval(sample, 300) : null
    return () => {
      dispose = true
      if (timer !== null) window.clearInterval(timer)
      player.current = null
      instance?.destroy?.()
      mount.replaceChildren()
      setReady(false)
      setPlaying(false)
      setMuted(true)
      setTime(0)
      setDuration(0)
    }
  }, [interactive, requested, active, failed, video.embed, editing])

  useEffect(() => {
    if (!ready || !player.current) return
    if (shouldPlay && visible) player.current.playVideo()
    else player.current.pauseVideo()
  }, [ready, shouldPlay, visible])

  function play() {
    if (!hasSpace() || failed) {
      window.open(video.watch, '_blank', 'noopener,noreferrer')
      return
    }
    setIntent(true)
    setRequested(true)
    player.current?.playVideo()
  }

  function pause() {
    setIntent(false)
    player.current?.pauseVideo()
  }

  function seek(seconds) {
    player.current?.seekTo(seconds, true)
    setTime(seconds)
  }

  const showPlayer = requested && active && !failed
  return <div className={'youtube-media ' + (showPlayer && ready ? 'youtube-ready' : '')}>
    <div className="youtube-surface" ref={surface}>
      {(!showPlayer || !ready) && <>
        <img className="youtube-thumbnail" src={video.preview} alt="" loading={mode === 'thumb' ? 'lazy' : 'eager'}
          referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />
        <span className="youtube-caption"><Play fill="currentColor" /> YouTube video</span>
        {mode === 'present' && active && (failed
          ? <a className="youtube-preview-play" href={video.watch} target="_blank" rel="noopener noreferrer"
            aria-label="Open on YouTube" title="Open on YouTube"><ExternalLink /></a>
          : <button type="button" className="youtube-preview-play"
            aria-label="Play YouTube video" onClick={play}><Play fill="currentColor" /></button>)}
      </>}
      {showPlayer && <div className="youtube-host" />}
    </div>
    {editing && <VideoControls playing={playing} muted={muted} duration={duration} time={time}
      play={play} pause={pause} reset={() => { pause(); seek(video.start) }} seek={seek}
      toggleMute={() => {
        if (!player.current) return
        const wasMuted = player.current.isMuted()
        if (wasMuted) player.current.unMute()
        else player.current.mute()
        setMuted(!wasMuted)
      }}>{watchLink}</VideoControls>}
  </div>
}

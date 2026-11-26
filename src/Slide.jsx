import React, { useEffect, useRef, useState } from 'react'
import { ImagePlus, Move } from 'lucide-react'
import { useMedia } from './storage'
import { layerTextFont, safeSrc, textAppearance } from './project'
import { snapPosition } from './alignment'
import { layerBounds, moveLayers } from './frames'
import { FrameControls } from './FrameControls'
import { youtubeVideo } from './youtube'
import { FileVideo, YouTubeMedia } from './VideoPlayback'

function Media({ layer, mode, enabled, previews, active, hovered, youtube, autoplay }) {
  if (youtube) return enabled
    ? <YouTubeMedia key={youtube.watch} video={youtube} mode={mode} active={active} hovered={hovered} autoplay={autoplay} />
    : null
  return <FileMedia layer={layer} mode={mode} enabled={enabled} previews={previews} active={active} hovered={hovered} />
}

function FileMedia({ layer, mode, enabled, previews, active, hovered }) {
  const mediaLink = safeSrc(layer.src)
  const [failed, setFailed] = useState(null)
  const [failedPreview, setFailedPreview] = useState(null)
  const screen = source => previews?.[source] && previews[source] !== failedPreview ? previews[source] : source
  const posterLink = safeSrc(layer.poster)
  const poster = useMedia(screen(posterLink), enabled)
  const src = useMedia(layer.type === 'image' ? screen(mediaLink) : mediaLink,
    enabled && (layer.type !== 'video' || mode !== 'thumb' || !layer.poster))
  if (!enabled) return null
  if (!mediaLink || failed === (src || poster)) {
    if (mode === 'present' && !layer.src) return null
    return <div className="media-placeholder"><ImagePlus size="14%" strokeWidth={1.2} />
      {mode === 'edit' && <span>{layer.src ? 'Could not load media' : 'Drop an image or video'}</span>}
    </div>
  }
  const crop = layer.crop
  const cropWidth = crop && Math.max(.01, 1 - crop.left - crop.right)
  const cropHeight = crop && Math.max(.01, 1 - crop.top - crop.bottom)
  const style = crop ? {
    width: (100 / cropWidth) + '%', height: (100 / cropHeight) + '%',
    left: (-100 * crop.left / cropWidth) + '%', top: (-100 * crop.top / cropHeight) + '%',
    objectFit: 'fill',
  } : { objectFit: layer.fit }

  if (layer.type === 'video' && mode !== 'thumb' && src) {
    return <FileVideo key={src} src={src} poster={poster} style={style} mode={mode} active={active} hovered={hovered}
      onError={() => setFailed(src)} />
  }
  if (layer.type === 'video' && !poster && src) {
    return <video src={src + (src.includes('#') ? '' : '#t=0.1')} style={style} muted playsInline preload="metadata" onError={() => setFailed(src)} />
  }
  if (poster || src) {
    const image = poster || src
    const isDisplayCopy = image === previews?.[posterLink] || image === previews?.[mediaLink]
    return <img src={image} style={style} decoding={mode === 'thumb' ? 'async' : 'sync'}
      onLoad={event => {
        if (isDisplayCopy && Math.max(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight) < 2) setFailedPreview(image)
      }}
      onError={() => {
        if (isDisplayCopy) setFailedPreview(image)
        else setFailed(image)
      }} alt="" draggable={false} />
  }
  return null
}

function SlideLayer({ layer, mode, enabled, selected, select, onMove, editText, beginCrop, originalFonts, previews,
  active, snap, layers, selection, setGuides, setDraft, autoplay }) {
  const drag = useRef(null)
  const [hovered, setHovered] = useState(false)
  const isText = layer.type === 'text'
  const isShape = layer.type === 'shape'
  const youtube = !isText && !isShape ? youtubeVideo(layer.src) : null
  const playable = mode === 'edit' && (layer.type === 'video' || youtube)
  const editing = mode === 'edit'
  const length = value => (value / 16) + 'cqw'
  const fallbackFont = layer.fontOverride
    ? JSON.stringify(layer.fontOverride.family) + ', sans-serif' : 'var(--deck-font)'
  const style = {
    left: layer.x + '%', top: layer.y + '%', width: layer.w + '%', height: layer.h + '%',
    rotate: layer.rotation ? layer.rotation + 'deg' : undefined,
    scale: !isText && (layer.flipX || layer.flipY) ? (layer.flipX ? '-1' : '1') + ' ' + (layer.flipY ? '-1' : '1') : undefined,
    '--layer-size': isText ? length(layer.size) : undefined, '--text-color': layer.color,
    fontWeight: layer.weight, fontStyle: layer.italic ? 'italic' : undefined, textAlign: layer.align,
    fontFamily: isText ? (originalFonts && layer.font ? JSON.stringify(layer.font) + ', ' + fallbackFont : fallbackFont) : undefined,
    padding: layer.insets ? ['top', 'right', 'bottom', 'left'].map(key => length(layer.insets[key])).join(' ') : undefined,
    justifyContent: { middle: 'center', bottom: 'flex-end' }[layer.anchor],
    whiteSpace: layer.noWrap ? 'pre' : undefined,
    borderRadius: layer.type === 'image' ? { rounded: '8% / 12%', ellipse: '50%' }[layer.mask] : undefined,
  }
  function pointerDown(event) {
    if (event.button !== 0) return
    event.stopPropagation()
    const toggle = event.ctrlKey || event.shiftKey
    const moving = selected ? selection : [layer]
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    drag.current = { toggle, ctrl: event.ctrlKey, moving, x: event.clientX, y: event.clientY,
      width: rect.width, height: rect.height }
    if (!selected && !toggle) select(layer.id)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event) {
    if (!drag.current) return
    const start = drag.current
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.origin) {
      if (Math.hypot(dx, dy) < 3) return
      start.moved = true
      if (start.ctrl) return
      if (!selected && start.toggle) select(layer.id)
      start.origin = layerBounds(start.moving)
      const movingIds = new Set(start.moving.map(item => item.id))
      start.targets = layers.filter(item => !movingIds.has(item.id))
    }
    if (!event.shiftKey) start.axis = undefined
    else start.axis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    const x = start.origin.x + (start.axis === 'y' ? 0 : dx / start.width * 100)
    const y = start.origin.y + (start.axis === 'x' ? 0 : dy / start.height * 100)
    const result = snapPosition(start.origin, start.targets,
      x, y, start.width, start.height, snap && !event.altKey, start.axis)
    start.position = result.position
    setDraft(positions(start))
    setGuides(result.guides)
  }
  function positions({ moving, position, origin }) {
    return moving.length === 1 ? new Map([[layer.id, position]])
      : moveLayers(moving, position.x - origin.x, position.y - origin.y)
  }
  function finishDrag(commit) {
    const record = drag.current
    if (!record) return
    drag.current = null
    setDraft(null)
    setGuides(null)
    const { position, origin } = record
    if (!commit) return
    if (!record.moved) select(layer.id, record.toggle)
    else if (position && (position.x !== origin.x || position.y !== origin.y)) onMove(positions(record))
  }
  function keyDown(event) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (delta) {
      event.preventDefault()
      const factor = event.shiftKey ? 5 : 1
      onMove(moveLayers(selected ? selection : [layer], delta[0] * factor, delta[1] * factor))
    }
    if (event.key === 'Enter' && isText) editText(layer.id)
  }
  return <div className={'slide-layer ' + (isText ? 'text-layer' : isShape ? 'shape-layer' : 'media-layer') +
    (selected ? ' selected-layer' : '') + (mode === 'present' && active ? ' motion-' + layer.animation : '')}
    style={style}
    data-layer-id={layer.id}
    data-playable={playable ? 'true' : undefined}
    onPointerEnter={playable ? event => { if (event.pointerType !== 'touch') setHovered(true) } : undefined}
    onPointerLeave={playable ? () => setHovered(false) : undefined}
    {...(editing && {
      tabIndex: 0, role: 'button', 'aria-label': layer.label || layer.type, 'aria-pressed': selected,
      onFocus: () => { if (!drag.current && !selected) select(layer.id) },
      onPointerDown: pointerDown, onPointerMove: pointerMove,
      onPointerUp: () => finishDrag(true), onPointerCancel: () => finishDrag(false), onLostPointerCapture: () => finishDrag(false),
      onDoubleClick: event => {
        if (event.ctrlKey || event.shiftKey) return
        if (isText) editText(layer.id)
        if (layer.type === 'image' && layer.src) beginCrop(layer.id)
      }, onKeyDown: keyDown,
    })}>
    {isText ? layer.paragraphs?.length
      ? layer.paragraphs.map((paragraph, index) => <div key={index} className="rich-paragraph" style={{
          textAlign: paragraph.align, lineHeight: paragraph.lineSize ? length(paragraph.lineSize) : paragraph.leading,
          marginBlockStart: paragraph.before ? length(paragraph.before) : undefined,
          marginBlockEnd: paragraph.after ? length(paragraph.after) : undefined,
        }}>
          {paragraph.runs.length ? paragraph.runs.map((run, runIndex) => <span key={runIndex}
            className={layer.backing ? 'text-backing' : undefined} style={{
            fontSize: run.size ? length(run.size) : undefined,
            color: `var(--preview-text-color, ${run.color || (run.hyperlink ? '#3e7287' : 'inherit')})`,
            fontWeight: run.weight ?? 400, fontStyle: run.italic ? 'italic' : 'normal',
            fontFamily: originalFonts && run.font ? JSON.stringify(run.font) + ', ' + fallbackFont : undefined,
            textDecoration: run.underline || run.hyperlink ? 'underline' : undefined, textTransform: run.caps ? 'uppercase' : undefined,
          }}>{run.text}</span>) : <br />}
        </div>)
      : <div><span className={layer.backing ? 'text-backing' : undefined}>{layer.text || (editing ? 'Empty text' : '')}</span></div>
      : isShape ? <Shape layer={layer} strokeWidth={length(layer.strokeWidth)} />
        : <Media layer={layer} mode={mode} enabled={enabled} previews={previews} active={active} hovered={hovered}
          youtube={youtube} autoplay={autoplay} />}
    {editing && youtube && <button type="button" className="youtube-frame-handle"
      aria-label="Select or move video frame" title="Drag to move; select to show resize handles">
      <Move /> Frame
    </button>}
  </div>
}

function Shape({ layer, strokeWidth }) {
  const style = {
    fill: `var(--preview-fill, ${layer.fill || 'none'})`, fillOpacity: layer.opacity,
    stroke: `var(--preview-stroke, ${layer.stroke || 'none'})`, strokeWidth, strokeDasharray: layer.dashed ? '5 4' : undefined,
  }
  const drawing = layer.kind === 'ellipse' ? <ellipse cx="50" cy="50" rx="50" ry="50" />
    : layer.kind === 'line' ? <line x1="0" y1="0" x2="100" y2="100" />
      : layer.kind === 'elbow' ? <polyline points="0,0 50,0 50,100 100,100" fill="none" />
        : <rect width="100" height="100" rx={layer.kind === 'rounded' ? 8 : 0} />
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={style} aria-hidden="true">{drawing}</svg>
}

export function Slide({ slide, project, mode, selected, select, onMove, onResize, editText, beginCrop, closeCrop,
  width, enabled = true, active = true, snap, cropping }) {
  const [guides, setGuides] = useState(null)
  const [frameDraft, setFrameDraft] = useState(null)
  const root = useRef(null)
  const editing = mode === 'edit'
  const autoplayYouTube = mode === 'present'
    ? slide.layers.find(layer => youtubeVideo(layer.src))?.id : null
  const selection = editing ? slide.layers.filter(layer => selected.has(layer.id)) : []
  const single = selection.length === 1 ? selection[0] : null
  const content = slide.layers.map(layer => {
      const patch = frameDraft?.get(layer.id)
      const frame = patch ? { ...layer, ...patch } : layer
      return <SlideLayer key={layer.id} layer={frame.type === 'text' ? textAppearance(project, slide, frame) : frame}
        mode={mode} enabled={enabled} active={active} previews={project.previews} snap={snap}
        autoplay={layer.id === autoplayYouTube}
        layers={slide.layers} selection={selection} setGuides={setGuides} setDraft={setFrameDraft}
        originalFonts={frame.type === 'text' && layerTextFont(project, slide, frame).useSourceFonts} select={select}
        onMove={onMove} editText={editText} beginCrop={beginCrop} selected={editing && selected.has(layer.id)} />
    })
  return <div ref={root} className={'slide ' + mode + '-slide' + (mode === 'present' && active ? ' transition-' + slide.transition : '')}
    style={{ backgroundColor: `var(--preview-background, ${slide.background})`,
      '--deck-font': JSON.stringify(slide.font || project.font) + ', sans-serif',
      fontFamily: 'var(--deck-font)', aspectRatio: project.aspect, width }}>
    {mode === 'edit' ? <div className="slide-content">{content}</div> : content}
    {single && <FrameControls key={single.id} layer={single} draft={frameDraft?.get(single.id)} root={root} setDraft={setFrameDraft}
      cropping={cropping} slideAspect={project.aspect} onChange={onResize} closeCrop={closeCrop}
      snap={snap} otherLayers={slide.layers} setGuides={setGuides} />}
    {selection.length > 1 && selection.map(layer => {
      const { x, y } = frameDraft?.get(layer.id) ?? layer
      return <div key={layer.id} className="frame-overlay" aria-hidden="true"
        style={{ left: x + '%', top: y + '%', width: layer.w + '%', height: layer.h + '%',
          rotate: layer.rotation ? layer.rotation + 'deg' : undefined }} />
    })}
    {editing && guides?.x != null && <div className="alignment-guide guide-x" style={{ left: guides.x + '%' }} />}
    {editing && guides?.y != null && <div className="alignment-guide guide-y" style={{ top: guides.y + '%' }} />}
  </div>
}

export function Thumbnail({ slide, project }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(null)
  const src = safeSrc(slide.thumbnail)
  const stored = src.startsWith('asset:')
  const resolved = useMedia(src, !stored || visible)
  const previewSrc = resolved && resolved !== failed ? resolved : ''
  const hasLinkedPreview = Boolean(src && !stored && previewSrc)
  useEffect(() => {
    if (hasLinkedPreview) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [hasLinkedPreview])
  return <div className="thumbnail" ref={ref} aria-hidden="true" style={{ aspectRatio: project.aspect }}>
    {previewSrc ? <img src={previewSrc} alt="" loading="lazy" decoding="async" onError={() => setFailed(previewSrc)} />
      : visible && (!stored || resolved !== '') && <Slide slide={slide} project={project} mode="thumb" />}
  </div>
}

import React, { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cropFor, imageBounds, panImage, resizeFrame, zoomImage } from './frames'
import { snapResize } from './alignment'

const handles = [
  ['nw', 'top left'], ['n', 'top'], ['ne', 'top right'],
  ['w', 'left'], ['e', 'right'],
  ['sw', 'bottom left'], ['s', 'bottom'], ['se', 'bottom right'],
]
const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

export function FrameControls({ layer, draft, root, setDraft, cropping, slideAspect, onChange, closeCrop,
  snap, otherLayers, setGuides }) {
  const drag = useRef(null)
  const surface = useRef(null)
  const [ready, setReady] = useState(false)
  const box = draft ?? layer

  function imageSize() {
    const image = root.current?.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"] img')
    return image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 0
  }

  useEffect(() => {
    if (!cropping) return
    const slide = root.current
    const update = () => setReady(Boolean(imageSize()))
    update()
    surface.current?.focus({ preventScroll: true })
    slide?.addEventListener('load', update, true)
    return () => slide?.removeEventListener('load', update, true)
  }, [cropping, root, layer.id, layer.src])

  function viewport() {
    const { width, height } = root.current.getBoundingClientRect()
    return { width, height }
  }

  function pointerDown(event, handle) {
    if (event.button !== 0 || (cropping && !layer.crop && !ready)) return
    event.preventDefault()
    event.stopPropagation()
    const aspect = imageSize()
    const size = viewport()
    if (!size.width || !size.height) return
    drag.current = {
      handle, x: event.clientX, y: event.clientY, size,
      image: cropping ? imageBounds(layer, aspect, slideAspect) : null,
      layer, control: event.currentTarget,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function changeFrame(base, handle, dx, dy, size, image, shift, align) {
    if (handle === 'pan') return { patch: { crop: cropFor(base, panImage(base, image, dx, dy, size)) } }
    const { frame, localFrame, guides } = align
      ? snapResize(base, handle, dx, dy, size, shift, image, otherLayers)
      : resizeFrame(base, handle, dx, dy, size, shift, image)
    return { patch: image ? { ...frame, crop: cropFor(localFrame, image) } : frame, guides }
  }

  function pointerMove(event) {
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.patch && Math.hypot(dx, dy) < 2) return
    const { patch, guides } = changeFrame(start.layer, start.handle, dx, dy, start.size, start.image,
      event.shiftKey, snap && !event.altKey)
    start.patch = patch
    setGuides(guides ?? null)
    setDraft(new Map([[layer.id, patch]]))
  }

  function finish(commit) {
    const gesture = drag.current
    if (!gesture) return
    drag.current = null
    setDraft(null)
    setGuides(null)
    if (!commit || !gesture.patch) return
    onChange(layer.id, gesture.patch)
    if (gesture.handle !== 'pan') requestAnimationFrame(() => {
      const stage = root.current?.closest('.fit-area')
      if (!stage || !gesture.control.isConnected) return
      const bounds = stage.getBoundingClientRect()
      const visible = { left: bounds.left + 12, top: bounds.top + 12,
        right: bounds.left + stage.clientWidth - 12, bottom: bounds.top + stage.clientHeight - 12 }
      const handle = gesture.control.getBoundingClientRect()
      stage.scrollBy({
        left: Math.min(0, handle.left - visible.left) + Math.max(0, handle.right - visible.right),
        top: Math.min(0, handle.top - visible.top) + Math.max(0, handle.bottom - visible.bottom),
      })
    })
  }

  function zoom(factor, direction) {
    if (drag.current || (!layer.crop && !ready)) return
    const image = imageBounds(layer, imageSize(), slideAspect)
    onChange(layer.id, { crop: cropFor(layer, zoomImage(layer, image, factor)) }, 'crop-zoom-' + direction)
  }

  function keyDown(event, handle) {
    if (event.key === 'Escape' && cropping) {
      event.stopPropagation()
      finish(false)
      closeCrop()
      return
    }
    if (cropping && ['+', '=', '-'].includes(event.key)) {
      event.preventDefault()
      const more = event.key !== '-'
      zoom(more ? 1.12 : 1 / 1.12, more ? 'in' : 'out')
      return
    }
    const delta = arrows[event.key]
    if (!delta || (cropping && !layer.crop && !ready)) return
    event.preventDefault()
    const image = cropping ? imageBounds(layer, imageSize(), slideAspect) : null
    const distance = event.shiftKey ? 10 : 2
    const { patch } = changeFrame(layer, handle, delta[0] * distance, delta[1] * distance, viewport(), image, event.shiftKey, false)
    onChange(layer.id, patch, 'frame-key-' + handle)
  }

  function dragProps(handle) {
    return {
      onPointerDown: event => pointerDown(event, handle), onPointerMove: pointerMove,
      onPointerUp: () => finish(true), onPointerCancel: () => finish(false), onLostPointerCapture: () => finish(false),
      onKeyDown: event => keyDown(event, handle),
    }
  }

  const frameStyle = {
      left: (box.x ?? layer.x) + '%', top: (box.y ?? layer.y) + '%',
      width: (box.w ?? layer.w) + '%', height: (box.h ?? layer.h) + '%',
      rotate: layer.rotation ? layer.rotation + 'deg' : undefined,
  }
  return <>
    {cropping && <div className="crop-shade" aria-hidden="true"><div className="crop-shade-window" style={frameStyle} /></div>}
    <div className={'frame-overlay ' + (cropping ? 'frame-cropping' : '')} style={frameStyle} onPointerDown={event => event.stopPropagation()}>
      {cropping && <div ref={surface} className="crop-surface" role="button" tabIndex={0}
        aria-label="Reposition image inside crop frame" {...dragProps('pan')} />}
      {handles.map(([handle, label]) => <button className={'frame-handle handle-' + handle} key={handle} type="button"
        aria-label={(cropping ? 'Crop frame, ' : 'Resize frame, ') + label}
        title={(cropping ? 'Crop frame: ' : 'Resize frame: ') + label} {...dragProps(handle)} />)}
    </div>
    {cropping && <div className="crop-zoom" onPointerDown={event => event.stopPropagation()}>
      <button className="icon-button" type="button" aria-label="Zoom out image" disabled={!ready && !layer.crop}
        onClick={() => zoom(1 / 1.12, 'out')}><Minus /></button>
      <span>Image zoom</span>
      <button className="icon-button" type="button" aria-label="Zoom in image" disabled={!ready && !layer.crop}
        onClick={() => zoom(1.12, 'in')}><Plus /></button>
    </div>}
  </>
}

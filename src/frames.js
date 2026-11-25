const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = value => Math.round(value * 10000) / 10000

export function layerBounds(layers) {
  if (layers.length === 1) return layers[0]
  const x = Math.min(...layers.map(layer => layer.x))
  const y = Math.min(...layers.map(layer => layer.y))
  return { x, y, w: Math.max(...layers.map(layer => layer.x + layer.w)) - x,
    h: Math.max(...layers.map(layer => layer.y + layer.h)) - y }
}

export function moveLayers(layers, dx, dy) {
  return new Map(layers.map(layer => [layer.id, { x: layer.x + dx, y: layer.y + dy }]))
}

export function pointerDelta(layer, dx, dy) {
  const angle = (layer.rotation ?? 0) * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy }
}

export function resizeFrame(layer, handle, dx, dy, viewport, lockAspect, image) {
  const local = pointerDelta(layer, dx, dy)
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const dw = local.x * 100 / viewport.width * horizontal
  const dh = local.y * 100 / viewport.height * vertical
  const maxSize = (start, length, anchor, flipped, origin, size) => {
    if (!image) return Infinity
    if (!anchor) {
      const center = start + length / 2
      return Math.max(length, 2 * Math.min(center - origin, origin + size - center))
    }
    return Math.max(length, (anchor === 1) !== Boolean(flipped) ? origin + size - start : start + length - origin)
  }
  const maxW = maxSize(layer.x, layer.w, horizontal, layer.flipX, image?.x, image?.w)
  const maxH = maxSize(layer.y, layer.h, vertical, layer.flipY, image?.y, image?.h)
  const minW = Math.min(layer.w, 0.35)
  const minH = Math.min(layer.h, 0.35)
  const wFactor = 1 + dw / layer.w
  const hFactor = 1 + dh / layer.h
  const scale = clamp(Math.abs(dw / layer.w) > Math.abs(dh / layer.h) ? wFactor : hFactor,
    Math.max(minW / layer.w, minH / layer.h), Math.min(maxW / layer.w, maxH / layer.h))
  const w = lockAspect ? layer.w * scale : clamp(layer.w + dw, minW, maxW)
  const h = lockAspect ? layer.h * scale : clamp(layer.h + dh, minH, maxH)
  const offsetX = horizontal * (w - layer.w)
  const offsetY = vertical * (h - layer.h)
  const localFrame = {
    x: layer.x + ((layer.flipX ? -offsetX : offsetX) - (w - layer.w)) / 2,
    y: layer.y + ((layer.flipY ? -offsetY : offsetY) - (h - layer.h)) / 2,
    w, h,
  }
  const screen = pointerDelta({ rotation: -(layer.rotation ?? 0) },
    offsetX * viewport.width / 100, offsetY * viewport.height / 100)
  const frame = {
    x: round(layer.x + (screen.x * 100 / viewport.width - (w - layer.w)) / 2),
    y: round(layer.y + (screen.y * 100 / viewport.height - (h - layer.h)) / 2),
    w: round(w), h: round(h),
  }
  return { frame, localFrame }
}

export function imageBounds(frame, imageAspect, slideAspect) {
  const { crop } = frame
  if (crop) {
    const w = frame.w / Math.max(0.01, 1 - crop.left - crop.right)
    const h = frame.h / Math.max(0.01, 1 - crop.top - crop.bottom)
    return { x: frame.x - crop.left * w, y: frame.y - crop.top * h, w, h }
  }
  if (!imageAspect || frame.fit === 'fill') return { x: frame.x, y: frame.y, w: frame.w, h: frame.h }
  const aspect = imageAspect / slideAspect
  const w = (frame.fit === 'contain' ? Math.min : Math.max)(frame.w, frame.h * aspect)
  const h = w / aspect
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h }
}

export function cropFor(frame, image) {
  return {
    left: (frame.x - image.x) / image.w,
    top: (frame.y - image.y) / image.h,
    right: (image.x + image.w - frame.x - frame.w) / image.w,
    bottom: (image.y + image.h - frame.y - frame.h) / image.h,
  }
}

function keepInFrame(frame, image) {
  const anchor = (start, frameSize, imageSize, offset) => {
    const other = start + frameSize - imageSize
    return clamp(offset, Math.min(start, other), Math.max(start, other))
  }
  return { ...image, x: anchor(frame.x, frame.w, image.w, image.x), y: anchor(frame.y, frame.h, image.h, image.y) }
}

export function panImage(frame, image, dx, dy, viewport) {
  const local = pointerDelta(frame, dx, dy)
  return keepInFrame(frame, { ...image,
    x: image.x + local.x * 100 / viewport.width * (frame.flipX ? -1 : 1),
    y: image.y + local.y * 100 / viewport.height * (frame.flipY ? -1 : 1),
  })
}

export function zoomImage(frame, image, factor) {
  const coverage = Math.max(frame.w / image.w, frame.h / image.h)
  const zoom = clamp(factor, Math.min(1, coverage), Math.max(1, 8 * coverage))
  const w = image.w * zoom
  const h = image.h * zoom
  const x = frame.x + frame.w / 2
  const y = frame.y + frame.h / 2
  return keepInFrame(frame, { x: x - (x - image.x) * zoom, y: y - (y - image.y) * zoom, w, h })
}

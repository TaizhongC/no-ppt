import { pointerDelta, resizeFrame } from './frames'

function axisSnap(start, length, targets, threshold) {
  let best
  for (const target of targets) {
    for (const offset of [0, length / 2, length]) {
      const distance = target - (start + offset)
      if (Math.abs(distance) <= threshold && (!best || Math.abs(distance) < Math.abs(best.distance))) {
        best = { target, distance }
      }
    }
  }
  return best
}

function alignmentTargets(layer, others) {
  const x = [0, 50, 100]
  const y = [0, 50, 100]
  for (const item of others) {
    if (item.id === layer.id) continue
    x.push(item.x, item.x + item.w / 2, item.x + item.w)
    y.push(item.y, item.y + item.h / 2, item.y + item.h)
  }
  return { x, y }
}

export function snapPosition(layer, others, x, y, width, height, snap, axis) {
  const targets = snap ? alignmentTargets(layer, others) : null
  const horizontal = snap && axis !== 'y' && axisSnap(x, layer.w, targets.x, 650 / width)
  const vertical = snap && axis !== 'x' && axisSnap(y, layer.h, targets.y, 650 / height)
  return {
    position: {
      x: axis === 'y' ? x : Math.round((x + (horizontal?.distance ?? 0)) * 1000) / 1000,
      y: axis === 'x' ? y : Math.round((y + (vertical?.distance ?? 0)) * 1000) / 1000,
    },
    guides: { x: horizontal?.target, y: vertical?.target },
  }
}

export function snapResize(layer, handle, dx, dy, viewport, lockAspect, image, others) {
  const resize = (x, y) => resizeFrame(layer, handle, x, y, viewport, lockAspect, image)
  let result = resize(dx, dy)
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  const scaleX = viewport.width / 100
  const scaleY = viewport.height / 100
  const rotate = (x, y) => pointerDelta({ rotation: -(layer.rotation ?? 0) }, x, y)
  const point = frame => {
    const offset = rotate(horizontal * frame.w * scaleX / 2, vertical * frame.h * scaleY / 2)
    return {
      x: (frame.x + frame.w / 2) * scaleX + offset.x,
      y: (frame.y + frame.h / 2) * scaleY + offset.y,
    }
  }
  const start = point(layer)
  const unsnapped = point(result.frame)
  const targets = alignmentTargets(layer, others)
  const nearX = axisSnap(unsnapped.x / scaleX, 0, targets.x, 6.5 / scaleX)
  const nearY = axisSnap(unsnapped.y / scaleY, 0, targets.y, 6.5 / scaleY)
  const deltaX = (nearX?.distance ?? 0) * scaleX
  const deltaY = (nearY?.distance ?? 0) * scaleY
  let guideX = nearX?.target
  let guideY = nearY?.target
  if (!lockAspect && horizontal && vertical) {
    result = resize(unsnapped.x - start.x + deltaX, unsnapped.y - start.y + deltaY)
  } else {
    const direction = rotate(horizontal * layer.w * scaleX, vertical * layer.h * scaleY)
    const length = Math.hypot(direction.x, direction.y)
    const adjustments = [
      ...(nearX && Math.abs(direction.x) > 0.001 ? [deltaX / direction.x] : []),
      ...(nearY && Math.abs(direction.y) > 0.001 ? [deltaY / direction.y] : []),
    ].filter(fraction => Math.abs(fraction) * length <= 9.2)
      .sort((left, right) => Math.abs(left) - Math.abs(right))
    if (adjustments.length) {
      const fraction = (horizontal ? result.frame.w / layer.w : result.frame.h / layer.h) - 1 + adjustments[0]
      result = resize(direction.x * fraction, direction.y * fraction)
    }
    if (Math.abs(direction.x) < 0.001) guideX = undefined
    if (Math.abs(direction.y) < 0.001) guideY = undefined
  }
  const snapped = point(result.frame)
  return { ...result, guides: {
    x: guideX != null && Math.abs(snapped.x - guideX * scaleX) < .2 ? guideX : undefined,
    y: guideY != null && Math.abs(snapped.y - guideY * scaleY) < .2 ? guideY : undefined,
  } }
}

export const fonts = ['Arial', 'Helvetica Neue', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Zaha Hadid Sans']
export const motion = [['none', 'None'], ['fade', 'Fade'], ['rise', 'Rise']]
export const shapes = [['rect', 'Rectangle'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['elbow', 'Elbow connector']]
export const isMedia = layer => layer.type === 'image' || layer.type === 'video'
export const defaultTypography = { title: 53, subtitle: 30, caption: 18, body: 36 }
export const textSlots = [['title', 'Title'], ['caption', 'Caption'], ['body', 'Text']]
export const layouts = [
  ['bleed', 'Full bleed', 'Edge-to-edge media with a title, subtitle and source.'],
  ['framed', 'Framed media', 'A white margin, a large media frame and a source line.'],
  ['split', 'Text + media', 'Text on the left, media on the right.'],
  ['comparison', 'Two-up media', 'Two independent media frames with a shared heading.'],
  ['blank', 'Blank', 'An empty canvas.'],
]
const uid = () => crypto.randomUUID()
export const newLayer = (type, props = {}) => ({
  id: uid(), type, x: 5, y: 8, w: 60, h: 12, rotation: 0, animation: 'none',
  ...(type === 'text'
    ? { label: 'Text', text: 'Your text here', size: 38, weight: 400, italic: false, align: 'left', color: '#191b19' }
    : type === 'shape'
      ? { label: 'Shape', kind: 'rect', fill: '#dff0da', opacity: 1, stroke: '', strokeWidth: 2 }
      : { label: 'Media frame', src: '', fit: 'cover' }),
  ...props,
})

export function makeSlide(template, starter = false) {
  const slide = { id: uid(), name: 'Untitled slide', template, background: '#ffffff', font: '', transition: 'none', layers: [] }
  if (template === 'blank') return slide
  if (template === 'comparison') {
    slide.layers = [
      newLayer('image', { label: 'Left media', x: 5, y: 23, w: 44, h: 64 }),
      newLayer('image', { label: 'Right media', x: 51, y: 23, w: 44, h: 64 }),
      newLayer('text', { label: 'Title', text: 'Slide title', w: 90, size: 62, weight: 700 }),
      newLayer('text', { label: 'Source', text: 'Source reference', y: 93, w: 90, h: 5, size: 19, color: '#606660' }),
    ]
    return slide
  }
  const bleed = template === 'bleed'
  const split = template === 'split'
  const frame = bleed ? { x: 0, y: 0, w: 100, h: 100 }
    : split ? { x: 51, y: 0, w: 49, h: 100 }
      : { x: 4, y: 23, w: 92, h: 64 }
  slide.layers = [
    newLayer('image', frame),
    newLayer('text', { label: 'Title', text: starter ? 'New presentation' : 'Slide title', w: split ? 43 : 85, size: 62, weight: 700, backing: bleed }),
    newLayer('text', { label: 'Subtitle', text: 'Add a subtitle', y: 17, w: split ? 43 : 85, size: 30, color: '#494d49', backing: bleed }),
    newLayer('text', { label: 'Source', text: 'Source reference', y: 93, w: split ? 43 : 85, h: 5, size: 19, color: '#606660', backing: bleed }),
  ]
  if (split) slide.layers.splice(3, 0, newLayer('text', { label: 'Body', text: 'Add your text here.', y: 33, w: 41, h: 48, size: 36 }))
  return slide
}

export function newProject() {
  return { version: 1, name: 'Untitled presentation', font: 'Arial', aspect: 16 / 9, typography: defaultTypography,
    slides: [makeSlide('bleed', true)] }
}

export function duplicateSlide(slide) {
  return { ...slide, id: uid(), layers: slide.layers.map(layer => ({ ...layer, id: uid() })) }
}

export function reorder(items, from, to) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

export function layerCategory(layer) {
  return layer.type === 'text' || layer.type === 'shape' ? layer.type : 'media'
}

export function insertLayers(layers, additions) {
  const priority = { media: 0, shape: 1, text: 2 }
  const next = [...layers]
  for (const layer of additions) {
    const rank = priority[layerCategory(layer)]
    const above = next.findIndex(item => priority[layerCategory(item)] > rank)
    next.splice(above < 0 ? next.length : above, 0, layer)
  }
  return next
}

export function canRestack(layers, selected, direction) {
  return layers.some((layer, index) => {
    const neighbor = layers[index + direction]
    return selected.has(layer.id) && neighbor && !selected.has(neighbor.id)
  })
}

export function restackLayers(layers, selected, direction) {
  const next = [...layers]
  const indices = next.map((_, index) => index)
  if (direction === 1) indices.reverse()
  for (const index of indices) {
    const neighbor = index + direction
    if (selected.has(next[index].id) && next[neighbor] && !selected.has(next[neighbor].id)) {
      const layer = next[index]
      next[index] = next[neighbor]
      next[neighbor] = layer
    }
  }
  return next
}

export function slideName(slide) {
  const title = slide.layers.find(layer => layer.type === 'text' && (layer.role === 'title' || layer.label === 'Title'))
  return title?.text.trim().split('\n')[0] || slide.name || 'Untitled slide'
}

export function textRole(slide, layer) {
  if (layer.role) return layer.role
  if (layer.label === 'Source' || layer.label === 'Caption') return 'caption'
  if (layer.label === 'Subtitle') return 'subtitle'
  if (layer.label === 'Title' && (slide.template !== 'custom' || (layer.size >= 26 && layer.text.trim().length <= 145))) return 'title'
  return 'custom'
}

export function slotForLayer(layer) {
  if (layer.type !== 'text') return null
  if (['title', 'caption', 'body'].includes(layer.role)) return layer.role
  if (layer.role === 'subtitle') return null
  if (layer.label === 'Title') return 'title'
  if (layer.label === 'Caption' || layer.label === 'Source') return 'caption'
  if (layer.label === 'Subtitle') return null
  return 'body'
}

export function makeTextSlot(slot, slide, project) {
  const narrow = slide.template === 'split'
  const overMedia = slide.template === 'bleed' || slide.layers.some(layer =>
    isMedia(layer) && layer.x < 4 && layer.y < 4 && layer.w >= 95 && layer.h >= 95)
  const size = project.typography?.[slot] ?? defaultTypography[slot]
  const props = {
    role: slot, label: textSlots.find(([id]) => id === slot)[1], size, backing: overMedia,
    w: narrow ? 43 : 85,
  }
  if (slot === 'title') return newLayer('text', { ...props, weight: 700, text: 'Slide title' })
  if (slot === 'caption') {
    return newLayer('text', { ...props, y: 93, h: 5, color: '#5b625b', text: 'Add a caption' })
  }
  return newLayer('text', { ...props, y: 33, h: 48, w: narrow ? 41 : 65, text: 'Add your text here.' })
}

export function textAppearance(project, slide, layer) {
  const role = textRole(slide, layer)
  if (!project.typography || role === 'custom') return layer
  const largeTitle = role === 'title' && slide.template === 'custom' && (layer.size >= 76 || layer.y > 24)
  const light = [1, 3, 5].every(offset => Number.parseInt(layer.color.slice(offset, offset + 2), 16) >= 155)
  const primary = role === 'title' || role === 'body'
  return {
    ...layer,
    size: largeTitle ? layer.size : project.typography[role] ?? defaultTypography[role],
    color: light ? (primary ? '#ffffff' : '#e4e7e4') : (primary ? '#191b19' : '#5b625b'),
    weight: role === 'title' ? 700 : 400,
    italic: false, font: largeTitle ? layer.font : '', paragraphs: undefined,
  }
}

export function layerTextFont(project, slide, layer) {
  return layer.fontOverride || {
    family: slide.font || project.font,
    useSourceFonts: Boolean(project.originalFonts && !slide.font),
  }
}

export function snapshotLayer(project, slide, source) {
  const layer = structuredClone(source)
  if (layer.type !== 'text') return { layer }
  return { layer, appearance: textAppearance(project, slide, layer), font: layerTextFont(project, slide, layer) }
}

export function pasteLayerSnapshot(project, slide, snapshot) {
  let layer = structuredClone(snapshot.layer)
  if (snapshot.appearance) {
    const destination = textAppearance(project, slide, snapshot.layer)
    const appearance = snapshot.appearance
    if (['size', 'color', 'weight', 'italic', 'font', 'paragraphs'].some(key => destination[key] !== appearance[key])) {
      layer = { ...structuredClone(appearance), role: 'custom' }
    }
    const font = layerTextFont(project, slide, layer)
    if (font.family !== snapshot.font.family || font.useSourceFonts !== snapshot.font.useSourceFonts) {
      layer.fontOverride = { ...snapshot.font }
    }
  }
  return { ...layer, id: uid() }
}

export function groupSlides(project) {
  const names = new Map((project.sections ?? []).map(section => [section.id, section.name]))
  const groups = []
  project.slides.forEach((slide, index) => {
    const id = names.has(slide.sectionId) ? slide.sectionId : ''
    if (groups.at(-1)?.id !== id) groups.push({ id, name: names.get(id) ?? 'Unsectioned', items: [] })
    groups.at(-1).items.push({ slide, index })
  })
  return groups
}

export function safeSrc(value) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (/^asset:[\w-]+$|^data:(image\/[\w.+-]+|video\/[\w.+-]+);base64,/i.test(url)) return url
  try {
    const parsed = new URL(url, document.baseURI)
    return ['http:', 'https:'].includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}

export function* mediaReferences(project) {
  for (const slide of project.slides) {
    if (slide.thumbnail) yield [slide, 'thumbnail']
    for (const layer of slide.layers) {
      if (layer.src) yield [layer, 'src']
      if (layer.poster) yield [layer, 'poster']
    }
  }
}

const number = (value, fallback) => Number.isFinite(value) ? value : fallback
const color = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback
const choice = (value, options, fallback) => options.includes(value) ? value : fallback
const alignments = ['left', 'center', 'right', 'justify']
const edges = ['top', 'right', 'bottom', 'left']

function readParagraphs(paragraphs) {
  if (!Array.isArray(paragraphs)) return undefined
  return paragraphs.map(paragraph => ({
    align: choice(paragraph?.align, alignments, undefined),
    leading: number(paragraph?.leading, undefined), lineSize: number(paragraph?.lineSize, undefined),
    before: number(paragraph?.before, undefined), after: number(paragraph?.after, undefined),
    runs: (Array.isArray(paragraph?.runs) ? paragraph.runs : []).map(run => ({
      text: string(run?.text), size: number(run?.size, undefined), color: color(run?.color, undefined),
      weight: choice(run?.weight, [400, 700], undefined), italic: typeof run?.italic === 'boolean' ? run.italic : undefined,
      underline: Boolean(run?.underline), font: string(run?.font), caps: Boolean(run?.caps), hyperlink: Boolean(run?.hyperlink),
    })),
  }))
}

export function parseProject(input) {
  if (input?.version !== 1 || !Array.isArray(input.slides) || !input.slides.length) {
    throw new Error('Choose a version 1 presentation JSON with at least one slide.')
  }
  return {
    version: 1, name: string(input.name, 'Untitled presentation'), font: string(input.font, 'Arial'),
    originalFonts: typeof input.originalFonts === 'boolean' ? input.originalFonts : undefined,
    typography: input.typography && Object.fromEntries(Object.entries(defaultTypography)
      .map(([role, size]) => [role, Math.min(160, Math.max(8, number(input.typography[role], size)))])),
    previews: input.previews && Object.fromEntries(Object.entries(input.previews)
      .filter(([source, preview]) => safeSrc(source).startsWith('asset:') && safeSrc(preview).startsWith('asset:'))),
    sections: Array.isArray(input.sections) ? input.sections.filter(s => typeof s?.id === 'string' && s.id)
      .map(s => ({ id: s.id, name: string(s.name, 'Untitled section') })) : [],
    editorRevision: number(input.editorRevision, 0),
    aspect: Math.min(3, Math.max(0.5, number(input.aspect, 16 / 9))),
    slides: input.slides.map(slide => {
      if (!Array.isArray(slide?.layers)) throw new Error('Every slide must have a layers array.')
      return {
        id: uid(), name: string(slide.name), template: string(slide.template, 'custom'),
        sectionId: string(slide.sectionId), sourceNumber: number(slide.sourceNumber, legacySourceNumber(slide)),
        background: color(slide.background, '#ffffff'), font: string(slide.font),
        thumbnail: safeSrc(thumbnailPath(slide.thumbnail)),
        transition: choice(slide.transition, ['none', 'fade'], 'none'),
        layers: slide.layers.map(layer => {
          if (!['text', 'image', 'video', 'shape'].includes(layer?.type)) throw new Error('Layer types must be text, image, video or shape.')
          const shared = {
            label: string(layer.label, layer.type), x: number(layer.x, 0), y: number(layer.y, 0),
            w: Math.max(0.1, number(layer.w, 30)), h: Math.max(0.1, number(layer.h, 10)),
            rotation: number(layer.rotation, 0), animation: choice(layer.animation, motion.map(([value]) => value), 'none'),
            flipX: Boolean(layer.flipX), flipY: Boolean(layer.flipY),
          }
          if (layer.type === 'text') return newLayer('text', {
            ...shared, text: string(layer.text), size: Math.max(1, number(layer.size, 38)),
            role: choice(layer.role, ['title', 'subtitle', 'caption', 'body', 'custom'], undefined),
            weight: layer.weight === 700 ? 700 : 400, italic: Boolean(layer.italic), backing: Boolean(layer.backing),
            align: choice(layer.align, alignments, 'left'), color: color(layer.color, '#191b19'),
            paragraphs: readParagraphs(layer.paragraphs), font: string(layer.font),
            fontOverride: layer.fontOverride?.family && typeof layer.fontOverride.family === 'string'
              ? { family: layer.fontOverride.family, useSourceFonts: Boolean(layer.fontOverride.useSourceFonts) } : undefined,
            insets: layer.insets && Object.fromEntries(edges.map(key => [key, number(layer.insets[key], 0)])),
            anchor: choice(layer.anchor, ['top', 'middle', 'bottom'], 'top'),
            noWrap: Boolean(layer.noWrap),
          })
          if (layer.type === 'shape') return newLayer('shape', {
            ...shared, kind: choice(layer.kind, shapes.map(([kind]) => kind), 'rect'),
            fill: color(layer.fill, ''), opacity: Math.min(1, Math.max(0, number(layer.opacity, 1))),
            stroke: color(layer.stroke, ''), strokeWidth: Math.max(0, number(layer.strokeWidth, 2)), dashed: Boolean(layer.dashed),
          })
          const crop = layer.crop && Object.fromEntries(edges.map(key => [key, number(layer.crop[key], 0)]))
          return newLayer(layer.type, {
            ...shared, src: safeSrc(layer.src), poster: safeSrc(layer.poster),
            mask: choice(layer.mask, ['rectangle', 'rounded', 'ellipse'], undefined),
            fit: choice(layer.fit, ['cover', 'contain', 'fill'], 'cover'), ...(crop ? { crop } : {}),
          })
        }),
      }
    }),
  }
}

export async function loadBundledDeck(checkpoint = false) {
  const response = await fetch(checkpoint ? './versions/no-ppt-v1.json' : './full-deck/starter.json')
  if (!response.ok) throw new Error('The bundled presentation could not be loaded.')
  const project = parseProject(await response.json())
  return { ...project, editorRevision: 2, typography: checkpoint ? project.typography : defaultTypography }
}

export async function loadPreviews() {
  try {
    const response = await fetch('./full-deck/previews.json?display=2')
    if (!response.ok) return {}
    const manifest = await response.json()
    return manifest.version === 2 ? manifest.images ?? {} : {}
  } catch {
    return {}
  }
}

export function needsDeckUpgrade(project) {
  return (project.editorRevision ?? 0) < 2 && isBundledDeck(project)
}

export function isBundledDeck(project) {
  return project.slides.some(slide => legacySourceNumber(slide) ||
    thumbnailPath(slide.thumbnail).startsWith('./full-deck/thumbnails/') ||
    (slide.sourceNumber && slide.layers.some(layer => layer.src?.startsWith('./full-deck/media/'))))
}

function legacySourceNumber(slide) {
  const match = /^\.\/full-deck\/reference\/Slide(\d+)\.png$/i.exec(slide.reference ?? '')
  return match ? Number(match[1]) : undefined
}

function thumbnailPath(path) {
  return string(path).replace('/reference/../thumbnails/', '/thumbnails/')
}

export function stripComparisonAssets(project) {
  if (!project.slides.some(slide => 'reference' in slide || (slide.thumbnail && thumbnailPath(slide.thumbnail) !== slide.thumbnail))) return project
  return {
    ...project,
    slides: project.slides.map(slide => {
      const { reference, ...rest } = slide
      return { ...rest, sourceNumber: slide.sourceNumber ?? legacySourceNumber(slide), thumbnail: thumbnailPath(slide.thumbnail) }
    }),
  }
}

export function upgradeDeck(stored, bundled) {
  const sources = new Map(bundled.slides.map(slide => [slide.sourceNumber, slide]))
  const hasSections = Boolean(stored.sections?.length)
  return {
    ...stored, editorRevision: 2, typography: stored.typography ?? bundled.typography,
    sections: hasSections ? stored.sections : bundled.sections,
    slides: stored.slides.map(slide => {
      const sourceNumber = slide.sourceNumber ?? legacySourceNumber(slide)
      const source = sources.get(sourceNumber)
      if (!source) return slide
      const layers = slide.layers.map(layer => {
        if (layer.type !== 'text' || !layer.paragraphs?.length) return layer
        const match = source.layers.find(item => item.type === 'text' && item.text.trim() === layer.text.trim()
          && item.paragraphs && item.x === layer.x && item.y === layer.y
          && item.size === layer.size && item.weight === layer.weight && item.italic === layer.italic)
        return match ? { ...layer, text: match.text, paragraphs: match.paragraphs } : layer
      })
      return { ...slide, sourceNumber, sectionId: hasSections ? slide.sectionId : source.sectionId, layers }
    }),
  }
}

const starterMedia = new Set([
  './media/image34.jpeg', './media/image29.jpg', './media/image30.jpg', './media/image33.jpeg',
  './media/image36.jpeg', './media/image37.jpeg', './media/image40.jpeg', './media/image44.png',
  './media/image250.png', './media/media14.mp4',
])

export function isLegacyStarter(project) {
  if (project?.slides?.length !== 8) return false
  const links = new Set(project.slides.flatMap(slide =>
    (slide.layers ?? []).flatMap(layer => [layer.src, layer.poster]).filter(src => starterMedia.has(src))))
  return links.size >= 5
}

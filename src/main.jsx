import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FilePlus2, FolderOpen,
  History, ImagePlus, Layers, LayoutGrid, Link2, Magnet, Maximize, Minus, Package, Play, Plus, Redo2, Save, Square, Trash2, Type, Undo2, X,
} from 'lucide-react'
import { Inspector } from './Inspector'
import { Slide } from './Slide'
import { SlideOrganizer } from './Organizer'
import { useProjectHistory } from './history'
import { duplicateSlide, insertLayers, isBundledDeck, isLegacyStarter, isMedia, layouts, loadBundledDeck, loadPreviews, makeSlide, makeTextSlot,
  needsDeckUpgrade, newLayer, newProject, parseProject, pasteLayerSnapshot, reorder, safeSrc, slideName, slotForLayer,
  restackLayers, snapshotLayer, stripComparisonAssets, upgradeDeck } from './project'
import { activateDeck, addAsset, archivedDeckId, bundledDeckId, initializeDeckLibrary, listVersions, projectForExport,
  readDeck, readDeckLibrary, readProject, readStarterArchive, readVersion, saveDeck,
  saveVersion, storeEmbeddedMedia, upgradeStarter } from './storage'
import { youtubeVideo } from './youtube'
import { applyAppTheme } from './theme'
import './style.css'

const isFileDrag = event => event.dataTransfer.types.includes('Files')
const canvasMargin = 24
const bundledCheckpoint = { number: 1, message: 'Original 135-slide checkpoint' }
const fileName = name => name.trim().replace(/[<>:"/\\|?*]/g, '-') || 'presentation'

function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

const jsonFile = data => new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })

async function chooseOutput(name, description, type, extension) {
  if (!window.showSaveFilePicker || navigator.userActivation?.isActive === false) return null
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: name,
      types: [{ description, accept: { [type]: [extension] } }] })
    return handle.createWritable()
  } catch (error) {
    if (error.name === 'SecurityError') return null
    throw error
  }
}

function workspacePadding(layer, width, aspect, viewport) {
  const height = width / aspect
  const hMargin = Math.max(canvasMargin, (viewport.width - width) / 2)
  const vMargin = Math.max(canvasMargin, (viewport.height - height) / 2)
  const padding = { paddingLeft: hMargin, paddingRight: hMargin, paddingTop: vMargin, paddingBottom: vMargin }
  if (!layer) return padding
  const boxWidth = layer.w * width / 100
  const boxHeight = layer.h * height / 100
  const centerX = layer.x * width / 100 + boxWidth / 2
  const centerY = layer.y * height / 100 + boxHeight / 2
  const angle = (layer.rotation ?? 0) * Math.PI / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const radiusX = (boxWidth * cos + boxHeight * sin) / 2
  const radiusY = (boxWidth * sin + boxHeight * cos) / 2
  return {
    paddingLeft: hMargin + Math.max(0, radiusX - centerX),
    paddingRight: hMargin + Math.max(0, centerX + radiusX - width),
    paddingTop: vMargin + Math.max(0, radiusY - centerY),
    paddingBottom: vMargin + Math.max(0, centerY + radiusY - height),
  }
}

async function loadSession() {
  const [saved, archive] = await Promise.allSettled([readProject(), readStarterArchive()])
  const project = saved.value
  const hasArchive = Boolean(archive.value)
  if (!hasArchive && archive.status === 'fulfilled' && isLegacyStarter(project)) {
    try {
      return await upgradeStarter(await loadBundledDeck())
    } catch {
      return { project, hasArchive, notice: 'Could not upgrade the starter. Your saved draft is still open.' }
    }
  }
  if (project && needsDeckUpgrade(project)) {
    try {
      return { project: upgradeDeck(project, await loadBundledDeck()), hasArchive }
    } catch {
      return { project, hasArchive, notice: 'The deck update could not load. Your saved draft is open.' }
    }
  }
  return { project: project ?? await loadBundledDeck(), hasArchive }
}

async function loadWorkspace() {
  const library = await readDeckLibrary().catch(() => null)
  if (library) {
    const project = await readDeck(library.activeId)
    if (!project) throw new Error('The last presentation could not be opened.')
    return { project: stripComparisonAssets(project), library, hasArchive: Boolean(await readStarterArchive().catch(() => null)) }
  }
  const session = await loadSession()
  const id = isBundledDeck(session.project) ? bundledDeckId
    : isLegacyStarter(session.project) && session.hasArchive ? archivedDeckId : crypto.randomUUID()
  try {
    const clean = stripComparisonAssets(session.project)
    const first = await initializeDeckLibrary(id, clean)
    const project = first.activeId === id ? clean : await readDeck(first.activeId)
    return { ...session, project: stripComparisonAssets(project), library: first }
  } catch {
    return { ...session, project: stripComparisonAssets(session.project),
      notice: 'Browser storage is unavailable. You can export the open presentation as JSON.' }
  }
}
const fileTypes = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', ogv: 'video/ogg', m4v: 'video/mp4',
}
function mediaMime(file) {
  if (/^(image|video)\//.test(file.type)) return file.type
  const extension = file.name.split('.').pop().toLowerCase()
  return Object.hasOwn(fileTypes, extension) ? fileTypes[extension] : ''
}

function Menu({ name, open, toggle, trigger, children, align = '', label, className = '', buttonClass = 'button' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function outside(event) { if (!ref.current?.contains(event.target)) toggle(null) }
    function escape(event) {
      if (event.key === 'Escape') {
        toggle(null)
        ref.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, toggle])
  return <div className={'menu ' + className} ref={ref}>
    <button className={buttonClass} aria-label={label} aria-expanded={open} onClick={() => toggle(open ? null : name)}>{trigger}</button>
    {open && <div className={'menu-popover ' + align}>{children}</div>}
  </div>
}

function LayoutGlyph({ type }) {
  return <span className={'layout-glyph glyph-' + type} aria-hidden="true"><i /><i /></span>
}

function SlideRail({ project, current, setCurrent, move, add, addSection, duplicate, remove, menu, setMenu, collapsed, toggle }) {
  return <aside className="rail" aria-label="Slides">
    <div className="rail-header"><div><h2>Slides</h2><span className="rail-count">{project.slides.length}</span></div>
      <Menu name="layouts" open={menu === 'layouts'} toggle={setMenu} trigger={<><Plus /> Add <ChevronDown className="chevron" /></>} align="right">
        {layouts.map(([id, name, description]) => <button key={id} onClick={() => { add(id); setMenu(null) }}>
          <LayoutGlyph type={id} /><span><strong>{name}</strong><small>{description}</small></span>
        </button>)}
        <button onClick={() => { setMenu(null); addSection() }}><Layers /><span>Add section here</span></button>
      </Menu>
    </div>
    <SlideOrganizer project={project} current={current} choose={setCurrent} move={move} collapsed={collapsed} toggle={toggle} />
    <SlideOrder project={project} current={current} move={move} duplicate={duplicate} remove={remove} />
  </aside>
}

function SlideOrder({ project, current, move, duplicate, remove }) {
  return <div className="rail-footer">
    <button className="icon-button" title="Move slide up" aria-label="Move slide up" disabled={current === 0} onClick={() => move(current, current - 1)}><ArrowUp /></button>
    <button className="icon-button" title="Move slide down" aria-label="Move slide down" disabled={current === project.slides.length - 1} onClick={() => move(current, current + 1)}><ArrowDown /></button>
    <span className="divider" />
    <button className="icon-button" title="Duplicate slide" aria-label="Duplicate slide" onClick={duplicate}><Copy /></button>
    <button className="icon-button danger" title="Delete slide" aria-label="Delete slide" disabled={project.slides.length <= 1} onClick={remove}><Trash2 /></button>
  </div>
}

function SlideJump({ current, total, chooseSlide }) {
  function jump(input) {
    const next = input.valueAsNumber
    if (Number.isInteger(next) && next >= 1 && next <= total && next !== current + 1) chooseSlide(next - 1)
    else input.value = current + 1
  }
  return <label className="slide-jump">Slide
    <input key={current} type="number" min={1} max={total} defaultValue={current + 1} aria-label="Go to slide"
      onFocus={event => event.currentTarget.select()} onBlur={event => jump(event.currentTarget)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
    of {total}
  </label>
}

function useFit(ref, aspect, ready = true, margin = 0) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ready || !ref.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref, ready])
  const { width, height } = viewport
  return { viewport, fit: Math.max(0, Math.min(width - 2 * margin, (height - 2 * margin) * aspect)) }
}

function Presenter({ project, index, setIndex, close, container }) {
  const { fit } = useFit(container, project.aspect)
  const last = project.slides.length - 1
  const [warming, setWarming] = useState(false)
  useEffect(() => {
    const timeout = setTimeout(() => setWarming(true), 80)
    return () => clearTimeout(timeout)
  }, [])
  useEffect(() => {
    const handle = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.target.closest('button,video') && event.key === ' ') return
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)
      const previous = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)
      if (next || previous || event.key === 'Home' || event.key === 'End') {
        if (event.target.closest('video') && event.key.startsWith('Arrow')) return
        event.preventDefault()
        setIndex(i => next ? Math.min(i + 1, last) : previous ? Math.max(i - 1, 0) : event.key === 'Home' ? 0 : last)
      }
    }
    let entered = Boolean(document.fullscreenElement)
    const onFullscreen = () => {
      if (document.fullscreenElement) entered = true
      else if (entered) close()
    }
    document.addEventListener('keydown', handle)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      document.removeEventListener('keydown', handle)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [close, last, setIndex])
  const nearby = (warming ? [index - 1, index, index + 1] : [index]).filter(i => i >= 0 && i <= last)
  return <>
    {fit > 0 && nearby.map(i => <div className="present-frame" key={project.slides[i].id}
      data-active={i === index} inert={i !== index} aria-hidden={i !== index}>
      <Slide slide={project.slides[i]} project={project} mode="present" width={fit} active={i === index} />
    </div>)}
    <div className="present-controls">
      <button className="icon-button" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft /></button>
      <button className="icon-button" aria-label="Next slide" disabled={index === last} onClick={() => setIndex(index + 1)}><ChevronRight /></button>
      <button className="icon-button" aria-label="Exit presentation" onClick={close}><X /></button>
    </div>
  </>
}

function App() {
  const { project, load: setProject, edit: editProject, undo, redo, canUndo, canRedo } = useProjectHistory()
  const [library, setLibrary] = useState(null)
  const [deckId, setDeckId] = useState(null)
  const [switching, setSwitching] = useState(false)
  const [slideId, setSlideId] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [layerClipboard, setLayerClipboard] = useState(null)
  const [cropId, setCropId] = useState(null)
  const [tab, setTab] = useState('slide')
  const [menu, setMenu] = useState(null)
  const [saved, setSaved] = useState('Saving…')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [transferStatus, setTransferStatus] = useState('')
  const [hasArchive, setHasArchive] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [fitRequest, setFitRequest] = useState(0)
  const [dropping, setDropping] = useState(false)
  const [presentIndex, setPresentIndex] = useState(null)
  const [grid, setGrid] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())
  const [snap, setSnap] = useState(true)
  const [versions, setVersions] = useState([])
  const [previews, setPreviews] = useState({})
  const displayProject = useMemo(() => ({ ...project, previews: { ...previews, ...project?.previews } }), [project, previews])
  const stage = useRef(null)
  const slideMount = useRef(null)
  const presenter = useRef(null)
  const presentButton = useRef(null)
  const mediaInput = useRef(null)
  const importInput = useRef(null)
  const packageInput = useRef(null)
  const textInput = useRef(null)
  const replaceTarget = useRef(null)
  const dropDepth = useRef(0)
  const current = project ? Math.max(0, project.slides.findIndex(item => item.id === slideId)) : 0
  const slide = project?.slides[current]
  const editingSlide = Boolean(slide && !grid && !switching && presentIndex === null)
  const selection = slide?.layers.filter(layer => selected.has(layer.id)) ?? []
  const activeLayer = selection.length === 1 ? selection[0] : null
  const cropping = Boolean(cropId && activeLayer?.id === cropId && activeLayer.type === 'image' && activeLayer.src)
  const { fit, viewport } = useFit(stage, project?.aspect ?? 16 / 9, Boolean(project) && !grid, canvasMargin)
  const canvasWidth = fit * zoom / 100

  useLayoutEffect(() => {
    if (!fitRequest) return
    const request = requestAnimationFrame(() => {
      if (!stage.current || !slideMount.current) return
      const viewport = stage.current.getBoundingClientRect()
      const canvas = slideMount.current.getBoundingClientRect()
      stage.current.scrollBy({
        left: canvas.left + canvas.width / 2 - viewport.left - stage.current.clientWidth / 2,
        top: canvas.top + canvas.height / 2 - viewport.top - stage.current.clientHeight / 2,
        behavior: 'auto',
      })
    })
    return () => cancelAnimationFrame(request)
  }, [fitRequest])

  useEffect(() => {
    let live = true
    loadWorkspace().then(async session => {
      if (!live) return
      const nextLibrary = session.library
      const id = nextLibrary?.activeId
      const nextVersions = id ? await listVersions(id, nextLibrary.legacyVersionsDeckId).catch(() => []) : []
      if (!live) return
      setLibrary(nextLibrary ?? null)
      setDeckId(id ?? null)
      setSlideId(nextLibrary?.decks.find(deck => deck.id === id)?.lastSlideId ?? null)
      setVersions(nextVersions ?? [])
      setProject(session.project)
      setHasArchive(session.hasArchive)
      if (session.upgraded) setNotice('Opened all 135 slides. Your eight-slide draft is archived in File.')
      else if (session.notice) setNotice(session.notice)
    }).catch(error => {
      if (!live) return
      setNotice(error.message)
      setProject(newProject())
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    loadPreviews().then(setPreviews)
  }, [])

  useEffect(() => {
    function historyKey(event) {
      if (cropping && event.key === 'Escape') {
        setCropId(null)
        return
      }
      if (switching || presentIndex !== null || !(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const forward = key === 'y' || (key === 'z' && event.shiftKey)
      if (forward && canRedo) { event.preventDefault(); redo() }
      else if (key === 'z' && !forward && canUndo) { event.preventDefault(); undo() }
    }
    window.addEventListener('keydown', historyKey)
    return () => window.removeEventListener('keydown', historyKey)
  }, [presentIndex, switching, cropping, canUndo, canRedo, undo, redo])

  useEffect(() => {
    function layerShortcut(event) {
      if (!editingSlide || event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return
      const target = event.target
      if (target instanceof Element && (target.isContentEditable || target.closest('input, textarea, select'))) return
      if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && selection.length) {
        event.preventDefault()
        removeSelectedLayers()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'c' && selection.length && window.getSelection()?.isCollapsed !== false) {
        event.preventDefault()
        copyLayer()
      } else if (key === 'v' && layerClipboard) {
        event.preventDefault()
        pasteLayer()
      }
    }
    window.addEventListener('keydown', layerShortcut)
    return () => window.removeEventListener('keydown', layerShortcut)
  }, [editingSlide, selected, layerClipboard, project, slide])

  useEffect(() => {
    if (!project || switching) return
    if (!deckId) {
      setSaved('Local save failed')
      return
    }
    let live = true
    setSaved('Saving…')
    const timeout = setTimeout(() => {
      saveDeck(deckId, project, slide?.id).then(next => {
        if (!live) return
        setLibrary(next)
        setSaved('Saved locally')
      })
        .catch(() => { if (live) setSaved('Local save failed') })
    }, 180)
    return () => { live = false; clearTimeout(timeout) }
  }, [deckId, project, switching])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 6600)
    return () => clearTimeout(timeout)
  }, [notice])

  function chooseSlide(index) {
    setSlideId(project.slides[index]?.id)
    select(null)
  }
  function select(id, toggle = false) {
    setSelected(previous => {
      if (!id) return new Set()
      if (!toggle) return previous.size === 1 && previous.has(id) ? previous : new Set([id])
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
    setCropId(previous => !toggle && previous === id ? previous : null)
    setTab('slide')
  }
  function clearSelectionOnBackground(event) {
    if (!selected.size || event.button !== 0 || !(event.target instanceof Element)) return
    if (event.target.closest('button, input, textarea, select, label, a, [contenteditable], .slide-layer, .frame-overlay, .crop-zoom')) return
    if (event.target === stage.current) {
      const bounds = stage.current.getBoundingClientRect()
      if (event.clientX >= bounds.left + stage.current.clientWidth ||
        event.clientY >= bounds.top + stage.current.clientHeight) return
    }
    setSelected(new Set())
    setCropId(null)
  }
  function beginCrop(id) {
    select(id)
    setCropId(id)
  }
  function closeCrop() { setCropId(null) }
  function updateProject(patch) {
    editProject(prev => ({
      ...prev, ...patch,
      slides: ('font' in patch || 'originalFonts' in patch || 'aspect' in patch || 'typography' in patch)
        ? prev.slides.map(item => ({ ...item, thumbnail: '' })) : prev.slides,
    }), 'deck:' + Object.keys(patch).join(','))
  }
  function changeSlide(id, apply, group) {
    editProject(prev => !prev.slides.some(item => item.id === id) ? prev : ({
      ...prev, slides: prev.slides.map(item => item.id === id ? { ...apply(item), thumbnail: '' } : item),
    }), group)
  }
  function updateSlide(patch) { changeSlide(slide.id, item => ({ ...item, ...patch })) }
  function updateLayer(id, patch, group) {
    updateLayers(new Map([[id, patch]]), group ? id + ':' + group : undefined)
  }
  function updateLayers(patches, group) {
    changeSlide(slide.id, item => ({
      ...item,
      layers: item.layers.map(layer => patches.has(layer.id) ? { ...layer, ...patches.get(layer.id) } : layer),
    }), group)
  }
  function removeSelectedLayers() {
    changeSlide(slide.id, item => ({ ...item, layers: item.layers.filter(layer => !selected.has(layer.id)) }))
    select(null)
  }
  function copyLayer() {
    if (!editingSlide || !selection.length) return
    setLayerClipboard(selection.map(layer => snapshotLayer(project, slide, layer)))
    setNotice(selection.length === 1 ? 'Layer copied.' : selection.length + ' layers copied.')
  }
  function pasteLayer() {
    if (!editingSlide || !layerClipboard) return
    const layers = layerClipboard.map(layer => pasteLayerSnapshot(project, slide, layer))
    changeSlide(slide.id, item => ({ ...item, layers: insertLayers(item.layers, layers) }))
    setSelected(new Set(layers.map(layer => layer.id)))
    setCropId(null)
    setTab('slide')
  }
  function addSlide(template, source) {
    const item = { ...(source ? duplicateSlide(source) : makeSlide(template)), sectionId: slide.sectionId }
    editProject(prev => {
      const slides = [...prev.slides]
      slides.splice(slides.findIndex(item => item.id === slide.id) + 1, 0, item)
      return { ...prev, slides }
    })
    setSlideId(item.id)
    select(null)
  }
  function moveSlide(from, to) {
    if (from === to) return
    editProject(prev => {
      const moved = reorder(prev.slides, from, to)
      if (moved === prev.slides) return prev
      moved[to] = { ...moved[to], sectionId: prev.slides[to].sectionId }
      return { ...prev, slides: moved }
    })
    setSlideId(slide.id)
  }
  function removeSlide() {
    if (project.slides.length < 2) return
    chooseSlide(current === project.slides.length - 1 ? current - 1 : current + 1)
    editProject(prev => ({ ...prev, slides: prev.slides.filter(item => item.id !== slide.id) }))
  }
  function toggleSection(id) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  function addSection() {
    const name = window.prompt('Section name')?.trim()
    if (!name) return
    const id = crypto.randomUUID()
    editProject(prev => {
      const start = prev.slides.findIndex(item => item.id === slide.id)
      if (start < 0) return prev
      const end = prev.slides.findIndex((item, i) => i > start && item.sectionId !== slide.sectionId)
      return { ...prev, sections: [...(prev.sections ?? []), { id, name }],
        slides: prev.slides.map((item, i) =>
          i >= start && (end < 0 || i < end) ? { ...item, sectionId: id } : item) }
    })
  }
  function renameSection() {
    const section = project.sections?.find(item => item.id === slide.sectionId)
    if (!section) return
    const name = window.prompt('Section name', section.name)?.trim()
    if (!name || name === section.name) return
    editProject(prev => ({ ...prev, sections: prev.sections.map(item => item.id === section.id ? { ...item, name } : item) }))
  }
  function appendText() {
    const layer = newLayer('text', { y: 45 })
    changeSlide(slide.id, item => ({ ...item, layers: insertLayers(item.layers, [layer]) }))
    editText(layer.id)
  }
  function addTextSlot(slot) {
    if (slide.layers.some(layer => slotForLayer(layer) === slot)) return
    const layer = makeTextSlot(slot, slide, project)
    changeSlide(slide.id, item => ({ ...item, layers: insertLayers(item.layers, [layer]) }))
    editText(layer.id)
  }
  function appendShape() {
    const layer = newLayer('shape', { x: 35, y: 35, w: 30, h: 30 })
    changeSlide(slide.id, item => ({ ...item, layers: insertLayers(item.layers, [layer]) }))
    select(layer.id)
  }
  function appendVideoLink() {
    const value = window.prompt('Paste a YouTube link or a direct video URL')?.trim()
    if (!value) return
    const src = safeSrc(value)
    if (!src) {
      setNotice('Enter a YouTube link or a direct video URL.')
      return
    }
    const label = youtubeVideo(src) ? 'YouTube video' : 'Linked video'
    const frame = slide.layers.find(layer => isMedia(layer) && !layer.src)
    if (frame) {
      updateLayer(frame.id, { type: 'video', src, label })
      select(frame.id)
      return
    }
    const layer = newLayer('video', { label, src, x: 14, y: 14, w: 72, h: 72 })
    changeSlide(slide.id, item => ({ ...item, layers: insertLayers(item.layers, [layer]) }))
    select(layer.id)
  }
  function editText(id) {
    select(id)
    requestAnimationFrame(() => {
      textInput.current?.focus()
      textInput.current?.select()
    })
  }
  function chooseMedia(id) {
    replaceTarget.current = id || null
    mediaInput.current.click()
  }
  async function addFiles(files, target) {
    if (busy) return
    const valid = Array.from(files).filter(mediaMime)
    if (!valid.length) {
      if (files.length) setNotice('Choose an image or video file.')
      return
    }
    setBusy(true)
    try {
      const additions = await Promise.all(valid.map(async file => {
        const mime = mediaMime(file)
        const asset = mime === file.type ? file : file.slice(0, file.size, mime)
        return { type: mime.split('/')[0], src: await addAsset(asset), label: file.name }
      }))
      const activeSlot = target || slide.layers.find(layer => isMedia(layer) && !layer.src)?.id
      const extra = additions.slice(activeSlot ? 1 : 0).map((props, index) =>
        newLayer(props.type, { ...props, x: 24 + (index % 4) * 3, y: 24 + (index % 4) * 3, w: 52, h: 52 }))
      changeSlide(slide.id, item => {
        const layers = item.layers.map(layer => layer.id === activeSlot
          ? { ...layer, ...additions[0], poster: '', crop: undefined, fit: 'cover' } : layer)
        return { ...item, layers: insertLayers(layers, extra) }
      })
      if (valid.length !== files.length) setNotice('Some files were skipped. Add images or videos.')
    } catch {
      setNotice('Could not save the media. Check available browser storage.')
    } finally {
      setBusy(false)
    }
  }
  async function exportProject() {
    setMenu(null)
    setBusy(true)
    try {
      const data = await projectForExport(project)
      downloadFile(jsonFile(data), fileName(project.name) + '.json')
      setNotice('Presentation JSON downloaded.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setBusy(false)
    }
  }
  async function exportPackage() {
    setMenu(null)
    setBusy(true)
    setTransferStatus('Preparing package…')
    const name = fileName(project.name) + '.zip'
    let output
    try {
      output = await chooseOutput(name, 'Presentation package', 'application/zip', '.zip')
      const { packageDeck } = await import('./deckPackage')
      const snapshots = []
      for (const version of versions) {
        const snapshot = await readVersion(deckId, library.legacyVersionsDeckId, version.number)
        if (!snapshot) throw new Error('Could not read v' + version.number + '.')
        snapshots.push({ ...version, project: snapshot })
      }
      if (deckId === bundledDeckId) snapshots.push({ ...bundledCheckpoint, project: await loadBundledDeck(true) })
      const blob = await packageDeck({ project, versions: snapshots, activeSlide: current, previews,
        output, progress: setTransferStatus })
      if (!output) downloadFile(blob, name)
      setNotice('Presentation package saved.')
    } catch (error) {
      await output?.abort().catch(() => {})
      if (error.name !== 'AbortError') setNotice('Could not package the presentation. ' + error.message)
    } finally {
      setBusy(false)
      setTransferStatus('')
    }
  }
  function importPackage(file) {
    if (!file) return
    switchDeck(crypto.randomUUID(), async () => {
      setTransferStatus('Opening package…')
      const { unpackDeck } = await import('./deckPackage')
      return unpackDeck(file, setTransferStatus)
    })
  }
  function importProject(file) {
    if (!file) return
    switchDeck(crypto.randomUUID(), async () => {
      const data = JSON.parse(await file.text())
      const clean = await storeEmbeddedMedia(parseProject(data))
      const project = { ...clean, editorRevision: 2 }
      const saved = data.savedVersion
      const versions = Number.isSafeInteger(saved?.number) && saved.number > 0 && typeof saved.message === 'string'
        ? [{ number: saved.number, message: saved.message, date: typeof saved.date === 'string' ? saved.date : null, project }]
        : undefined
      return { project, versions }
    })
  }
  function openProject(next, lastSlideId = null) {
    setProject(stripComparisonAssets(next))
    setSlideId(lastSlideId)
    setCollapsed(new Set())
    select(null)
  }
  async function switchDeck(id, create) {
    setMenu(null)
    if (busy || id === deckId) return
    if (!deckId || !library) {
      setNotice('Browser storage is unavailable. Export the current presentation to keep a copy.')
      return
    }
    setBusy(true)
    setSwitching(true)
    try {
      await saveDeck(deckId, project, slide?.id)
      let next = await readDeck(id)
      if (!next && create) {
        const created = await create()
        next = created.project
        if (!next) throw new Error('The presentation could not be found.')
        try {
          await saveDeck(id, next, created.lastSlideId ?? next.slides[0].id, created.versions)
        } catch (error) {
          await created.discard?.().catch(() => {})
          throw error
        }
      }
      if (!next) throw new Error('The presentation could not be found.')
      const nextVersions = await listVersions(id, library.legacyVersionsDeckId)
      const nextLibrary = await activateDeck(id)
      setLibrary(nextLibrary)
      setDeckId(id)
      setVersions(nextVersions ?? [])
      setGrid(false)
      openProject(next, nextLibrary.decks.find(deck => deck.id === id)?.lastSlideId)
    } catch (error) {
      setNotice('Could not open the presentation. ' + (error?.message ?? 'Browser storage could not complete the import.'))
    } finally {
      setSwitching(false)
      setBusy(false)
      setTransferStatus('')
    }
  }
  function createDeck() {
    const names = new Set(library?.decks.map(deck => deck.name))
    names.add(project.name)
    const next = newProject()
    let suffix = 2
    while (names.has(next.name)) next.name = 'Untitled presentation ' + suffix++
    switchDeck(crypto.randomUUID(), () => ({ project: next }))
  }
  async function commitVersion() {
    setMenu(null)
    const message = window.prompt('Commit message for this version')?.trim()
    if (!message) return
    setBusy(true)
    const savedVersion = { number: (versions[0]?.number ?? (deckId === bundledDeckId ? 1 : 0)) + 1,
      message, date: new Date().toISOString() }
    const name = fileName(project.name) + '-v' + savedVersion.number + '.json'
    let output
    try {
      output = await chooseOutput(name, 'Presentation version', 'application/json', '.json')
      const file = jsonFile({ ...project, savedVersion })
      if (output) {
        await output.write(file)
        await output.close()
      } else downloadFile(file, name)
      const next = await saveVersion(deckId, library.legacyVersionsDeckId, project, savedVersion)
      setVersions(next)
      setNotice('Saved v' + savedVersion.number + ' to disk.')
    } catch (error) {
      await output?.abort().catch(() => {})
      if (error.name !== 'AbortError') setNotice(error.message || 'The version could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  async function openVersion(number) {
    setMenu(null)
    if (!window.confirm('Open v' + number + '? Save a version first to keep your current edits.')) return
    setBusy(true)
    try {
      const next = number === 1 && deckId === bundledDeckId ? await loadBundledDeck(true)
        : await readVersion(deckId, library.legacyVersionsDeckId, number)
      if (!next) throw new Error('This version could not be found.')
      openProject(next)
      setNotice('Opened v' + number + '.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setBusy(false)
    }
  }
  function openBundledDeck() {
    switchDeck(bundledDeckId, async () => ({ project: await loadBundledDeck() }))
  }
  function openArchivedStarter() {
    switchDeck(archivedDeckId, async () => ({ project: await readStarterArchive() }))
  }
  function startPresentation() {
    setMenu(null)
    closeCrop()
    setPresentIndex(current)
    presenter.current.hidden = false
    presenter.current.focus()
    presenter.current.requestFullscreen?.().catch(() => {})
  }
  const closePresentation = useCallback(() => {
    setPresentIndex(null)
    if (document.fullscreenElement === presenter.current) document.exitFullscreen?.().catch(() => {})
    requestAnimationFrame(() => presentButton.current?.focus())
  }, [])

  if (!project) return <div className="loading">Opening presentation…</div>
  const aspectLabel = [[16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [9 / 16, '9:16']].find(([value]) => value === project.aspect)?.[1] || project.aspect.toFixed(2) + ':1'

  return <>
    <div className="editor" inert={presentIndex !== null || switching} aria-busy={switching} onPointerDown={clearSelectionOnBackground}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand"><span className="brand-mark"><Layers size={19} /></span><span>no<span className="brand-slash">/</span>ppt</span></div>
          <span className="divider" />
          <Menu name="decks" label="Switch presentation" open={menu === 'decks'} toggle={setMenu}
            className="deck-menu" buttonClass="project-name"
            trigger={<><span>{project.name || 'Untitled presentation'}</span><ChevronDown size={14} /></>}>
            <div className="deck-list">
              {library?.decks.map(deck => <button key={deck.id} disabled={busy} aria-current={deck.id === deckId ? 'true' : undefined}
                onClick={() => switchDeck(deck.id)}>
                {deck.id === deckId ? <Check /> : <Layers />}
                <span><strong>{deck.id === deckId ? project.name || deck.name : deck.name}</strong>
                  <small>{deck.id === deckId ? project.slides.length : deck.slideCount} slides</small></span>
              </button>)}
            </div>
            <button onClick={() => { setMenu(null); setGrid(false); setTab('deck') }}><Type /> Deck settings</button>
            <button disabled={busy} onClick={createDeck}><FilePlus2 /> New presentation</button>
          </Menu>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 /></button>
          <button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Redo2 /></button>
          <button className="icon-button grid-toggle" aria-label="Slide grid" title="Slide grid" aria-pressed={grid}
            onClick={() => { closeCrop(); setGrid(value => !value) }}><LayoutGrid /></button>
          <Menu name="versions" label="Versions" open={menu === 'versions'} toggle={setMenu}
            trigger={<><History /><span className="versions-label">Versions</span><ChevronDown className="chevron" /></>} align="right">
            <button disabled={busy || !deckId} onClick={commitVersion}><Save /> Save version</button>
            <div className="version-list">
              {[...versions, ...(deckId === bundledDeckId ? [bundledCheckpoint] : [])].map(({ number, message }) =>
                <button key={number} disabled={busy} onClick={() => openVersion(number)} title={message}>
                  <span className="version-number">v{number}</span><span className="version-message">{message}</span>
                </button>)}
            </div>
          </Menu>
          <Menu name="file" open={menu === 'file'} toggle={setMenu} trigger={<>File <ChevronDown className="chevron" /></>} align="right">
            <button disabled={busy} onClick={createDeck}><FilePlus2 /> New presentation</button>
            <button disabled={busy} onClick={() => {
              setMenu(null)
              importInput.current.click()
            }}><FolderOpen /> Open JSON</button>
            <button disabled={busy} onClick={() => { setMenu(null); packageInput.current.click() }}><FolderOpen /> Unpack ZIP</button>
            <button disabled={busy} onClick={openBundledDeck}><Layers /> Open AI Tectonism (135 slides)</button>
            {hasArchive && <button disabled={busy} onClick={openArchivedStarter}><FolderOpen /> Open archived starter draft</button>}
            <button disabled={busy} onClick={exportProject}><Download /> Export JSON</button>
            <button disabled={busy} onClick={exportPackage}><Package /> Package ZIP</button>
          </Menu>
          <button ref={presentButton} className="button present-button" onClick={startPresentation}><Play size={15} fill="currentColor" /> Present</button>
        </div>
      </header>
      {grid ? <main className="sorter" aria-label="Slide grid">
        <div className="sorter-toolbar">
          <h2>Slide grid <small>{project.slides.length} slides</small></h2>
          <div className="canvas-actions">
            <button className="button" onClick={addSection}><Plus /> Add section here</button>
            <button className="button" disabled={!slide.sectionId} onClick={renameSection}>Rename section</button>
            <button className="button" onClick={() => setGrid(false)}>Back to editor</button>
          </div>
        </div>
        <SlideOrganizer project={displayProject} current={current} choose={chooseSlide} move={moveSlide}
          collapsed={collapsed} toggle={toggleSection} grid openEditor={() => setGrid(false)} />
        <SlideOrder project={project} current={current} move={moveSlide} duplicate={() => addSlide(null, slide)} remove={removeSlide} />
      </main> : <div className="editor-body">
        <SlideRail project={displayProject} current={current} setCurrent={chooseSlide} move={moveSlide} add={addSlide} addSection={addSection}
          duplicate={() => addSlide(null, slide)} remove={removeSlide} menu={menu} setMenu={setMenu}
          collapsed={collapsed} toggle={toggleSection} />
        <main className="workspace">
          <div className="canvas-toolbar">
            <span title={slideName(slide)}>{slideName(slide)}</span>
            <div className="canvas-actions">
              <button className="button" onClick={appendText}><Type /> Text</button>
              <button className="button" onClick={() => chooseMedia()}><ImagePlus /> Media</button>
              <button className="button icon-button" aria-label="Add video link" title="Add video link"
                onClick={appendVideoLink}><Link2 /></button>
              <button className="button icon-button" aria-label="Add shape" title="Add shape"
                onClick={appendShape}><Square /></button>
              <button className="icon-button" aria-label="Snap to alignment guides" title="Snap to alignment guides (hold Alt to bypass)"
                aria-pressed={snap} onClick={() => setSnap(value => !value)}><Magnet /></button>
            </div>
          </div>
          <div className={'stage ' + (dropping ? 'is-dropping' : '')} onDragEnter={event => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            dropDepth.current++
            setDropping(true)
          }} onDragOver={event => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
          onDragLeave={() => {
            dropDepth.current = Math.max(0, dropDepth.current - 1)
            if (!dropDepth.current) setDropping(false)
          }} onDrop={event => {
            if (!isFileDrag(event)) return
            event.preventDefault()
            setDropping(false)
            dropDepth.current = 0
            const layer = activeLayer && isMedia(activeLayer) && !activeLayer.src ? activeLayer : null
            addFiles(event.dataTransfer.files, layer?.id)
          }}>
            <div className="fit-area" ref={stage}>
              {fit > 0 && <div className="slide-workspace"
                style={workspacePadding(activeLayer, canvasWidth, project.aspect, viewport)}>
                <div className="slide-mount" ref={slideMount} style={{ width: canvasWidth }}>
                  <Slide key={slide.id} slide={slide} project={displayProject} mode="edit"
                    selected={selected} select={select} onMove={updateLayers} onResize={updateLayer} editText={editText} snap={snap}
                    cropping={cropping} beginCrop={beginCrop} closeCrop={closeCrop} />
                </div>
              </div>}
            </div>
            {dropping && <div className="drop-overlay"><ImagePlus /> Drop images or videos</div>}
          </div>
          <div className="canvas-footer">
            <div className="slide-position">
              <SlideJump current={current} total={project.slides.length} chooseSlide={chooseSlide} />
              <span className="footer-aspect"><span />{aspectLabel}</span>
            </div>
            <div className="zoom-controls">
              <button className="icon-button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(z => z - 10)}><Minus /></button>
              <span title="Percentage of fit size">{zoom}%</span>
              <button className="icon-button" aria-label="Zoom in" disabled={zoom >= 160} onClick={() => setZoom(z => z + 10)}><Plus /></button>
              <button className="icon-button" aria-label="Fit slide to canvas" title="Fit slide to canvas"
                onClick={() => { setZoom(100); setFitRequest(value => value + 1) }}><Maximize /></button>
            </div>
          </div>
        </main>
        <Inspector tab={tab} setTab={setTab} slide={slide} project={project} selected={selected} select={select} selection={selection}
          slideMount={slideMount}
          updateLayer={updateLayer} updateLayers={updateLayers}
          updateSlide={updateSlide} updateProject={updateProject}
          restack={direction => changeSlide(slide.id, item => ({ ...item, layers: restackLayers(item.layers, selected, direction) }))}
          removeSelectedLayers={removeSelectedLayers}
          replaceMedia={chooseMedia} textRef={textInput} cropping={cropping}
          copyLayer={copyLayer} pasteLayer={pasteLayer} canPaste={Boolean(layerClipboard)} addTextSlot={addTextSlot}
          toggleCrop={() => cropping ? closeCrop() : beginCrop(activeLayer.id)} />
      </div>}
      <footer className="app-footer"><span role="status"><span className={'save-icon ' + (saved === 'Local save failed' ? 'save-error' : '')}><Check /></span>{transferStatus || (busy ? 'Working…' : saved)}</span>
        <span>JSON presentation</span></footer>
    </div>
    <input type="file" accept="image/*,video/*,.mov,.m4v" multiple hidden ref={mediaInput} onChange={event => {
      const files = [...event.target.files]
      addFiles(files, replaceTarget.current)
      replaceTarget.current = null
      event.target.value = ''
    }} />
    <input type="file" accept=".json,application/json" hidden ref={importInput} onChange={event => {
      importProject(event.target.files[0])
      event.target.value = ''
    }} />
    <input type="file" accept=".zip,application/zip" hidden ref={packageInput} onChange={event => {
      importPackage(event.target.files[0])
      event.target.value = ''
    }} />
    <div className="presenter" hidden={presentIndex === null} ref={presenter} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Presentation">
      {presentIndex !== null && <Presenter project={displayProject} index={presentIndex} setIndex={setPresentIndex}
        close={closePresentation} container={presenter} />}
    </div>
    {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X /></button></div>}
  </>
}

applyAppTheme()
createRoot(document.getElementById('root')).render(<App />)

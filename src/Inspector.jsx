import React, { useLayoutEffect, useRef } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, ClipboardPaste, Copy, Crop, Image, Italic,
  Plus, Square, Trash2, Type, Upload, Video } from 'lucide-react'
import { canRestack, defaultTypography, fonts, layerCategory, layouts, motion, shapes, slotForLayer, textAppearance,
  textRole, textSlots } from './project'
import { layerBounds, moveLayers } from './frames'
import { youtubeVideo } from './youtube'
import { editTextRuns, formatTextRuns, uniformTextRuns } from './richText'

function FontMenu({ value, onChange, inheritLabel }) {
  const options = fonts.includes(value) || !value ? fonts : [value, ...fonts]
  return <select value={value ?? '__mixed__'} onChange={event => onChange(event.target.value)}>
    {value === undefined && <option value="__mixed__" disabled>Mixed</option>}
    {inheritLabel && <option value="">{inheritLabel}</option>}
    {options.map(font => <option key={font}>{font}</option>)}
  </select>
}
const iconByType = { text: Type, image: Image, video: Video, shape: Square }

function Numeric({ name, value, min, max, step = 1, onChange }) {
  return <label className="field number-field"><span>{name}</span>
    <input type="number" value={value ?? ''} placeholder={value === undefined ? 'Mixed' : undefined}
      min={min} max={max} step={step} onChange={event => {
      const next = event.target.valueAsNumber
      if (Number.isFinite(next)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)))
    }} />
  </label>
}

function ColorField({ name, value, property, previewTarget, onCommit }) {
  const input = useRef(null)
  const pending = useRef(null)

  function commit() {
    const draft = pending.current
    if (!draft) return
    pending.current = null
    clearTimeout(draft.timer)
    draft.targets.forEach(target => target.style.removeProperty(draft.property))
    draft.apply()
  }

  useLayoutEffect(() => {
    if (!pending.current) input.current.value = value ?? '#000000'
  }, [value])
  useLayoutEffect(() => commit, [])

  function preview(event) {
    const color = event.currentTarget.value
    if (pending.current?.color === color || (!pending.current && color === value)) return
    clearTimeout(pending.current?.timer)
    const targets = pending.current?.targets ?? [previewTarget()].flat().filter(Boolean)
    targets.forEach(target => target.style.setProperty(property, color))
    pending.current = {
      color, targets, property, timer: setTimeout(commit, 160),
      apply: () => { if (color !== value) onCommit(color) },
    }
  }

  return <label className="field"><span>{name}{value === undefined ? ' (mixed)' : ''}</span>
    <input ref={input} type="color" defaultValue={value ?? '#000000'}
    onInput={preview} onChange={preview} onBlur={commit} /></label>
}

function sharedValue(values) {
  return values.every(value => value === values[0]) ? values[0] : undefined
}

function detachText(layer, appearance, patch) {
  const baseline = appearance !== layer ? { size: appearance.size, weight: appearance.weight, color: appearance.color,
    italic: appearance.italic, font: appearance.font, paragraphs: appearance.paragraphs } : {}
  return { ...baseline, ...patch, role: 'custom' }
}

function TextProperties({ layers, slide, project, updateLayers, textRef, previewLayer, batch = false }) {
  const items = layers.map(layer => ({ layer, appearance: textAppearance(project, slide, layer) }))
  const apply = (patchFor, group) => updateLayers(
    new Map(items.map(({ layer, appearance }) => [layer.id, patchFor(layer, appearance)])),
    group ? slide.id + ':' + layers.map(layer => layer.id).join(',') + ':' + group : undefined,
  )
  const sharedAppearance = (key, fallback = (_, appearance) => appearance[key]) => sharedValue(items.flatMap(({ appearance }) =>
    batch && appearance.paragraphs?.some(paragraph => paragraph.runs.length)
      ? appearance.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run[key] ?? fallback(run, appearance)))
      : [appearance[key]]))
  const role = sharedValue(layers.map(layer => textRole(slide, layer)))
  const font = sharedValue(layers.map(layer => layer.fontOverride?.family ?? ''))
  const bold = sharedAppearance('weight', () => 400)
  const italic = sharedAppearance('italic', () => false)
  const alignment = sharedValue(layers.flatMap(layer =>
    batch && layer.paragraphs?.length ? layer.paragraphs.map(paragraph => paragraph.align ?? layer.align) : [layer.align]))

  function uniform(key, value) {
    apply((layer, appearance) => detachText(layer, appearance, uniformTextRuns(appearance, key, value)), key)
  }
  function format(key, current, enabled, disabled) {
    if (batch) {
      uniform(key, current === enabled ? disabled : enabled)
      return
    }
    const field = textRef.current
    const from = field?.selectionStart ?? 0
    const to = field?.selectionEnd ?? from
    apply((layer, appearance) => detachText(layer, appearance, formatTextRuns(appearance, from, to, key, enabled, disabled)))
  }
  return <>
    {!batch && <label className="field"><span>Content</span><textarea ref={textRef} rows={4} value={layers[0].text}
      onChange={event => apply(layer => editTextRuns(layer, event.target.value), 'content')} /></label>}
    <label className="field"><span>Text style</span><select value={role ?? '__mixed__'} onChange={event => apply(() => ({ role: event.target.value }))}>
      {role === undefined && <option value="__mixed__" disabled>Mixed</option>}
      <option value="custom">Custom</option><option value="title">Title</option>
      <option value="subtitle">Subtitle</option><option value="caption">Caption</option><option value="body">Body</option>
    </select></label>
    <label className="field"><span>Font family</span><FontMenu value={font}
      inheritLabel={slide.font ? 'Use slide font' : project.originalFonts ? 'Use inherited fonts' : 'Use deck font'}
      onChange={family => apply(() => ({ fontOverride: family ? { family, useSourceFonts: false } : undefined }))} /></label>
    <div className="field-row">
      <Numeric name="Font size" value={sharedAppearance('size')} min={1} max={600} onChange={size => uniform('size', size)} />
      <ColorField name="Text color" value={sharedAppearance('color', (run, appearance) => run.hyperlink ? '#3e7287' : appearance.color)}
        property="--preview-text-color" previewTarget={() => layers.map(layer => previewLayer(layer.id))}
        onCommit={color => uniform('color', color)} />
    </div>
    <div className="text-tools">
      <div className="segmented">
        <button type="button" title="Bold" aria-label="Bold" aria-pressed={bold === undefined ? 'mixed' : bold === 700}
          onMouseDown={event => event.preventDefault()} onClick={() => format('weight', bold, 700, 400)}><Bold /></button>
        <button type="button" title="Italic" aria-label="Italic" aria-pressed={italic === undefined ? 'mixed' : italic}
          onMouseDown={event => event.preventDefault()} onClick={() => format('italic', italic, true, false)}><Italic /></button>
      </div>
      <div className="segmented">
        {[[AlignLeft, 'left'], [AlignCenter, 'center'], [AlignRight, 'right']].map(([Icon, align]) =>
          <button type="button" key={align} title={'Align ' + align} aria-label={'Align ' + align} aria-pressed={alignment === align}
            onClick={() => apply(layer => ({ align, paragraphs: layer.paragraphs?.map(p => ({ ...p, align })) }))}><Icon /></button>)}
      </div>
    </div>
    <TextCheckbox label="White backing" value={sharedValue(layers.map(layer => Boolean(layer.backing)))}
      onChange={backing => apply(() => ({ backing }))} />
    <TextCheckbox label="Wrap text to frame" value={sharedValue(layers.map(layer => !layer.noWrap))}
      onChange={wrap => apply(() => ({ noWrap: !wrap }))} />
  </>
}

function TextCheckbox({ label, value, onChange }) {
  return <label className="check-field"><input type="checkbox" checked={value === true}
    ref={node => { if (node) node.indeterminate = value === undefined }}
    onChange={event => onChange(event.target.checked)} /> {label}</label>
}

function MediaProperties({ layer, change, replaceMedia, cropping, toggleCrop }) {
  const linked = layer.src?.startsWith('asset:')
  return <>
    <label className="field"><span>Media link</span><input type="text"
      placeholder={linked ? 'Using a browser upload' : 'Paste a media or YouTube link'} value={linked ? '' : layer.src}
      onChange={event => {
        const src = event.target.value
        change({ src, poster: '', crop: undefined, ...(youtubeVideo(src) && { type: 'video' }) })
      }} /></label>
    <button className="button full-width" onClick={() => replaceMedia(layer.id)}><Upload />{layer.src ? 'Replace file' : 'Choose file'}</button>
    <div className="field-row">
      <label className="field"><span>Media type</span><select value={layer.type} onChange={event => change({ type: event.target.value, poster: '' })}><option value="image">Image</option><option value="video">Video</option></select></label>
      <label className="field"><span>Fit</span><select value={layer.fit} onChange={event => change({ fit: event.target.value, crop: undefined })}><option value="cover">Cover</option><option value="contain">Contain</option><option value="fill">Stretch</option></select></label>
    </div>
    {layer.type === 'image' && <>
      <label className="field"><span>Mask shape</span><select value={layer.mask || 'rectangle'}
        onChange={event => change({ mask: event.target.value })}>
        <option value="rectangle">Rectangle</option><option value="rounded">Rounded rectangle</option><option value="ellipse">Ellipse</option>
      </select></label>
      <div className="media-crop-actions">
        <button className="button" type="button" aria-pressed={cropping} disabled={!layer.src} onClick={toggleCrop}>
          <Crop /> {cropping ? 'Done cropping' : 'Crop image'}
        </button>
        {layer.crop && <button className="button" type="button" onClick={() => change({ crop: undefined, fit: 'cover' })}>Reset crop</button>}
      </div>
      {cropping && <p className="crop-instructions">Drag the image to reposition it, or drag the handles to change the crop.</p>}
    </>}
  </>
}

function ShapeProperties({ layer, change, previewTarget }) {
  return <>
    <label className="field"><span>Shape</span><select value={layer.kind} onChange={event => {
      const kind = event.target.value
      const stroke = ['line', 'elbow'].includes(kind) && !layer.stroke ? '#191b19' : layer.stroke
      change({ kind, stroke })
    }}>
      {shapes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <div className="field-row">
      <ColorField name="Fill color" value={layer.fill || '#ffffff'} property="--preview-fill"
        previewTarget={previewTarget} onCommit={fill => change({ fill }, 'fill')} />
      <ColorField name="Stroke color" value={layer.stroke || '#000000'} property="--preview-stroke"
        previewTarget={previewTarget} onCommit={stroke => change({ stroke }, 'stroke')} />
    </div>
    <div className="field-row">
      <Numeric name="Fill opacity" value={layer.opacity} min={0} max={1} step={0.1} onChange={opacity => change({ opacity })} />
      <Numeric name="Stroke width" value={layer.stroke ? layer.strokeWidth : 0} min={0} max={100} step="any"
        onChange={strokeWidth => change({ strokeWidth, stroke: layer.stroke || '#191b19' })} />
    </div>
  </>
}

export function Inspector({ tab, setTab, slide, project, selected, selection, select, updateLayer, updateLayers, updateSlide,
  updateProject, slideMount, restack, removeSelectedLayers, textRef, replaceMedia, cropping, toggleCrop, copyLayer,
  pasteLayer, canPaste, addTextSlot }) {
  const layer = selection.length === 1 ? selection[0] : null
  const textLayers = selection.filter(item => item.type === 'text')
  const previewSlide = () => slideMount.current?.querySelector('.edit-slide')
  const previewLayer = id => previewSlide()?.querySelector('[data-layer-id="' + CSS.escape(id) + '"]')
  const bounds = selection.length > 1 ? layerBounds(selection) : null
  const template = layouts.find(([id]) => id === slide.template)?.[1] || 'Custom'
  const roleLayers = new Map()
  const groups = { text: [], shape: [], media: [] }
  for (const item of [...slide.layers].reverse()) {
    const slot = slotForLayer(item)
    if (slot && !roleLayers.has(slot)) roleLayers.set(slot, item)
    else groups[layerCategory(item)].push(item)
  }
  function layerButton(item, label) {
    const Icon = iconByType[item.type]
    return <button className={selected.has(item.id) ? 'layer-item active-layer' : 'layer-item'} key={item.id}
      aria-pressed={selected.has(item.id)} onClick={event => select(item.id, event.ctrlKey || event.shiftKey)}><Icon /><span>{label}</span></button>
  }
  const layerActions = selection.length > 0 && <div className="mini-actions">
    <button className="icon-button" title="Bring forward" aria-label="Bring layer forward"
      disabled={!canRestack(slide.layers, selected, 1)} onClick={() => restack(1)}><ArrowUp /></button>
    <button className="icon-button" title="Send backward" aria-label="Send layer backward"
      disabled={!canRestack(slide.layers, selected, -1)} onClick={() => restack(-1)}><ArrowDown /></button>
    <button className="icon-button danger" title="Remove selected layers (Delete)"
      aria-label={layer ? 'Remove layer' : 'Remove selected layers'} onClick={removeSelectedLayers}><Trash2 /></button>
  </div>
  return <aside className="inspector" aria-label="Properties">
    <div className="inspector-tabs" aria-label="Property views">
      <button className={tab === 'slide' ? 'current-tab' : ''} aria-pressed={tab === 'slide'} onClick={() => setTab('slide')}>Slide</button>
      <button className={tab === 'deck' ? 'current-tab' : ''} aria-pressed={tab === 'deck'} onClick={() => setTab('deck')}>Deck</button>
    </div>
    {tab === 'deck' ? <div className="inspector-scroll">
      <section className="property-group">
        <h2>Deck settings</h2>
        <label className="field"><span>Presentation name</span><input value={project.name} onChange={event => updateProject({ name: event.target.value })} /></label>
        <label className="field"><span>Global font</span><FontMenu value={project.font}
          onChange={font => updateProject({ font, ...(project.originalFonts !== undefined && { originalFonts: false }) })} /></label>
        {project.originalFonts !== undefined && <label className="check-field">
          <input type="checkbox" checked={project.originalFonts} onChange={event => updateProject({ originalFonts: event.target.checked })} /> Use source fonts
        </label>}
        <label className="field"><span>Aspect ratio</span><select value={project.aspect} onChange={event => updateProject({ aspect: Number(event.target.value) })}>
          {![16 / 9, 4 / 3, 1, 9 / 16].includes(project.aspect) && <option value={project.aspect}>Custom</option>}
          <option value={16 / 9}>16:9</option><option value={4 / 3}>4:3</option><option value={1}>1:1</option><option value={9 / 16}>9:16</option>
        </select></label>
        <label className="check-field"><input type="checkbox" checked={Boolean(project.typography)}
          onChange={event => updateProject({ typography: event.target.checked ? defaultTypography : null })} /> Shared typography</label>
        {project.typography && <div className="typography-settings">
          {[['Title size', 'title'], ['Subtitle size', 'subtitle'], ['Caption size', 'caption'], ['Body size', 'body']].map(([name, key]) =>
            <Numeric key={key} name={name} value={project.typography[key] ?? defaultTypography[key]} min={8} max={160}
              onChange={size => updateProject({ typography: { ...project.typography, [key]: size } })} />)}
        </div>}
      </section>
    </div> : <div className="inspector-scroll">
      <section className="property-group">
        <div className="section-heading layer-heading">
          <h2>Layers</h2><span className="layer-template" title={template}>{template}</span>
          <div className="mini-actions">
            <button className="icon-button" type="button" title="Copy selected layers (Ctrl+C)" aria-label="Copy layer"
              disabled={!selection.length} onClick={copyLayer}><Copy /></button>
            <button className="icon-button" type="button" title="Paste layer (Ctrl+V)" aria-label="Paste layer"
              disabled={!canPaste} onClick={pasteLayer}><ClipboardPaste /></button>
          </div>
        </div>
        <div className="layer-groups">
          <h3 className="layer-group-heading">Text</h3>
          <div className="layer-slots">
            {textSlots.map(([slot, label]) => {
              const item = roleLayers.get(slot)
              return item ? layerButton(item, label) : <div className="layer-item missing-layer" key={slot}>
                <Type /><span>{label}</span><button className="icon-button" type="button"
                  title={'Add ' + label.toLowerCase()} aria-label={'Add ' + label.toLowerCase()}
                  onClick={() => addTextSlot(slot)}><Plus /></button>
              </div>
            })}
          </div>
          {groups.text.length > 0 && <div className="layer-list">
            {groups.text.map(item => layerButton(item, item.label || item.type))}
          </div>}
          {[['shape', 'Shapes'], ['media', 'Media']].map(([category, name]) => groups[category].length > 0 &&
            <div key={category}>
              <h3 className="layer-group-heading">{name}</h3>
              <div className="layer-list">{groups[category].map(item => layerButton(item, item.label || item.type))}</div>
            </div>)}
        </div>
      </section>
      {layer ? <section className="property-group" key={layer.id}>
        <div className="section-heading">
          <h2>{layer.label || layer.type}</h2>
          {layerActions}
        </div>
        {layer.type === 'text' ? <TextProperties layers={[layer]} slide={slide} project={project}
          updateLayers={updateLayers} textRef={textRef} previewLayer={previewLayer} />
          : layer.type === 'shape' ? <ShapeProperties layer={layer}
            change={(patch, group) => updateLayer(layer.id, patch, group)} previewTarget={() => previewLayer(layer.id)} />
            : <MediaProperties layer={layer} change={patch => updateLayer(layer.id, patch)} replaceMedia={replaceMedia}
              cropping={cropping} toggleCrop={toggleCrop} />}
        <h3>Position &amp; size (%)</h3>
        <div className="field-row geometry">
          {[['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h']].map(([name, key]) =>
            <Numeric key={key} name={name} value={layer[key]} step="any" min={key === 'w' || key === 'h' ? 0.1 : undefined} onChange={value => updateLayer(layer.id, { [key]: value })} />)}
        </div>
        <div className="field-row">
          <Numeric name="Rotation (°)" value={layer.rotation} step="any" onChange={rotation => updateLayer(layer.id, { rotation })} />
          <label className="field"><span>Animation</span><select value={layer.animation} onChange={event => updateLayer(layer.id, { animation: event.target.value })}>
            {motion.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
        </div>
      </section> : selection.length > 1 ? <section className="property-group">
        <div className="section-heading">
          <h2>{selection.length} layers selected</h2>
          {layerActions}
        </div>
        {textLayers.length > 0 && <>
          {textLayers.length !== selection.length && <h3>{textLayers.length} text {textLayers.length === 1 ? 'layer' : 'layers'}</h3>}
          <TextProperties key={textLayers.map(item => item.id).join(',')} layers={textLayers} slide={slide} project={project}
            updateLayers={updateLayers} previewLayer={previewLayer} batch />
        </>}
        <h3>Selection position (%)</h3>
        <div className="field-row">
          <Numeric name="X" value={Number(bounds.x.toFixed(4))} step="any"
            onChange={x => updateLayers(moveLayers(selection, x - bounds.x, 0))} />
          <Numeric name="Y" value={Number(bounds.y.toFixed(4))} step="any"
            onChange={y => updateLayers(moveLayers(selection, 0, y - bounds.y))} />
        </div>
      </section> : <section className="property-group">
        <h2>Slide settings</h2>
        <label className="field"><span>Font override</span><FontMenu value={slide.font} inheritLabel="Use deck font"
          onChange={font => updateSlide({ font })} /></label>
        <div className="field-row">
          <ColorField key={slide.id} name="Background" value={slide.background} property="--preview-background"
            previewTarget={previewSlide} onCommit={background => updateSlide({ background })} />
          <label className="field"><span>Transition</span><select value={slide.transition} onChange={event => updateSlide({ transition: event.target.value })}><option value="none">None</option><option value="fade">Fade</option></select></label>
        </div>
      </section>}
    </div>}
  </aside>
}

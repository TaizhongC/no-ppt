import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { groupSlides, slideName } from './project'
import { Thumbnail } from './Slide'

export function SlideOrganizer({ project, current, choose, move, collapsed, toggle, grid, openEditor }) {
  const dragged = useRef(null)
  const list = useRef(null)
  const [target, setTarget] = useState(null)
  const groups = groupSlides(project)
  const showSections = groups.some(group => group.id)

  useEffect(() => {
    const scroller = list.current
    const active = scroller?.querySelector('.active-slide')
    if (!active) return
    const box = scroller.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.top < box.top) scroller.scrollTop += item.top - box.top
    if (item.bottom > box.bottom) scroller.scrollTop += item.bottom - box.bottom
  }, [current, grid])

  function dropOn(index) {
    return {
      onDragOver: event => {
        if (dragged.current === null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setTarget(index)
      },
      onDrop: event => {
        if (dragged.current === null) return
        event.preventDefault()
        move(dragged.current, index)
        dragged.current = null
        setTarget(null)
      },
    }
  }
  return <div ref={list} className={grid ? 'sorter-scroll' : 'slide-list'}>
    {groups.map(({ id, name, items }, index) => {
      const hidden = collapsed.has(id)
      const last = items.at(-1).index
      const Chevron = hidden ? ChevronRight : ChevronDown
      return <section className="slide-group" key={id + ':' + index}>
        {showSections && <button className={'section-toggle ' + (hidden && target === last ? 'section-target' : '')}
          aria-expanded={!hidden} onClick={() => toggle(id)} {...dropOn(last)}>
          <Chevron /><span>{name}</span><small>{items.length}</small>
        </button>}
        {!hidden && <ol className="slide-group-items">
          {items.map(({ slide, index }) => <li key={slide.id} className={target === index ? 'drop-target' : ''}
            {...dropOn(index)}>
            <button className={'slide-entry ' + (current === index ? 'active-slide' : '')}
              aria-current={current === index ? 'true' : undefined} onClick={() => choose(index)}
              onDoubleClick={grid ? openEditor : undefined} draggable onDragStart={event => {
                dragged.current = index
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', slide.id)
              }} onDragEnd={() => { dragged.current = null; setTarget(null) }}>
              <span className="slide-num">{String(index + 1).padStart(2, '0')}</span>
              <Thumbnail slide={slide} project={project} />
              <span className="thumbnail-title" title={slideName(slide)}>{slideName(slide)}</span>
              {!grid && <GripVertical className="grip" />}
            </button>
          </li>)}
        </ol>}
      </section>
    })}
  </div>
}

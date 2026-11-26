import { useEffect, useState } from 'react'

import { isLegacyStarter, mediaReferences } from './project'
import { activateLocalPresentation, isDiskPresentation, listLocalPresentations, saveLocalPresentation } from './localPresentations'
import { localLibraryIndex } from './presentationLibrary'

let database
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('no-ppt', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects')
      request.result.createObjectStore('assets')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(error => {
    database = undefined
    throw error
  })
  return database
}
async function read(store, key) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function put(store, key, value) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite')
    const request = transaction.objectStore(store).put(value, key)
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Browser storage could not save the file.'))
  })
}
export const readProject = () => read('projects', 'current')
export const readStarterArchive = () => read('projects', 'starter-archive')
export const bundledDeckId = 'ai-tectonism'
export const archivedDeckId = 'archived-starter'
const libraryKey = 'deck-library'
const deckKey = id => 'deck:' + id
export const readDeckLibrary = () => read('projects', libraryKey)
export const readDeck = id => read('projects', deckKey(id))

async function updateLibrary(apply) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const request = store.get(libraryKey)
    let result
    let failure
    request.onsuccess = () => {
      try {
        result = apply(store, request.result)
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Browser storage could not save the presentation.'))
  })
}

function deckEntry(id, project, lastSlideId) {
  return { id, name: project.name?.trim() || 'Untitled presentation', slideCount: project.slides.length, lastSlideId }
}

export function initializeDeckLibrary(id, project) {
  return updateLibrary((store, library) => {
    if (library) return library
    const first = { activeId: id, legacyVersionsDeckId: id, decks: [deckEntry(id, project, project.slides[0].id)] }
    store.put(project, deckKey(id))
    store.put(first, libraryKey)
    return first
  })
}

export async function saveDeck(id, project, lastSlideId, versions) {
  if (isDiskPresentation(id)) {
    const snapshots = versions && await Promise.all(versions.map(async version => ({
      ...version, project: await projectForExport(version.project),
    })))
    await saveLocalPresentation(id, { project: { ...await projectForExport(project), previews: project.previews },
      lastSlideId, versions: snapshots })
  }
  return updateLibrary((store, library) => {
    if (!library) throw new Error('The presentation library is unavailable.')
    const entry = deckEntry(id, project, lastSlideId)
    const saved = library.decks.find(deck => deck.id === id)
    store.put(project, deckKey(id))
    if (versions?.length) {
      const index = versions.map(({ project: snapshot, ...metadata }) => {
        store.put(snapshot, versionKey(id, library.legacyVersionsDeckId, metadata.number))
        return metadata
      })
      store.put(index, versionKey(id, library.legacyVersionsDeckId, 'index'))
    }
    if (saved?.name === entry.name && saved.slideCount === entry.slideCount && saved.lastSlideId === entry.lastSlideId) return library
    const decks = saved ? library.decks.map(deck => deck.id === id ? entry : deck) : [...library.decks, entry]
    const next = { ...library, decks }
    store.put(next, libraryKey)
    return next
  })
}

export async function activateDeck(id) {
  if (isDiskPresentation(id)) await activateLocalPresentation(id)
  return updateLibrary((store, library) => {
    if (!library?.decks.some(deck => deck.id === id)) throw new Error('The presentation could not be found.')
    const next = { ...library, activeId: id }
    store.put(next, libraryKey)
    return next
  })
}

// Disk files are authoritative. Rebuild the browser index on every launch so
// clearing site data or editing deck.json outside the editor is recoverable.
export async function restoreLocalPresentations() {
  const local = await listLocalPresentations()
  if (!local?.decks.length) return
  return updateLibrary((store, existing) => {
    const { library, archiveBrowserLibrary } = localLibraryIndex(existing, local)
    // Preserve the old index, projects, versions and media without merging
    // browser-only entries back into the local folder library.
    if (archiveBrowserLibrary) store.put(existing, 'before-local-deck-reconciliation')
    for (const deck of local.decks) {
      store.put(deck.project, deckKey(deck.id))
      const index = deck.versions.map(({ project, ...version }) => {
        store.put(project, versionKey(deck.id, library.legacyVersionsDeckId, version.number))
        return version
      })
      store.put(index, versionKey(deck.id, library.legacyVersionsDeckId, 'index'))
    }
    store.put(library, libraryKey)
    return library
  })
}

const versionKey = (id, legacyId, number) => (id === legacyId ? '' : deckKey(id) + ':') + 'version-' + number
export const listVersions = (id, legacyId) => read('projects', versionKey(id, legacyId, 'index'))
export const readVersion = (id, legacyId, number) => read('projects', versionKey(id, legacyId, number))

export async function saveVersion(id, legacyId, project, version) {
  if (isDiskPresentation(id)) {
    const previous = await listVersions(id, legacyId) ?? []
    if (version.number !== (previous[0]?.number ?? (id === bundledDeckId ? 1 : 0)) + 1) {
      throw new Error('A newer version was saved. Reopen the presentation before saving another version.')
    }
    const snapshots = await Promise.all(previous.map(async entry => ({ ...entry, project: await readVersion(id, legacyId, entry.number) })))
    await saveDeck(id, project, project.slides[0]?.id, [{ ...version, project }, ...snapshots])
    return listVersions(id, legacyId)
  }
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const indexKey = versionKey(id, legacyId, 'index')
    const index = store.get(indexKey)
    let versions
    let failure
    index.onsuccess = () => {
      const previous = index.result ?? []
      const number = (previous[0]?.number ?? (id === bundledDeckId ? 1 : 0)) + 1
      if (version.number !== number) {
        failure = new Error('A newer version was published in another tab. Reopen the presentation before publishing again.')
        transaction.abort()
        return
      }
      versions = [version, ...previous]
      store.put(project, versionKey(id, legacyId, number))
      store.put(versions, indexKey)
    }
    transaction.oncomplete = () => resolve(versions)
    transaction.onabort = () => reject(failure ?? transaction.error)
  })
}

export async function upgradeStarter(fullDeck) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const current = store.get('current')
    const archived = store.get('starter-archive')
    let result
    archived.onsuccess = () => {
      const previous = current.result
      if (archived.result || !isLegacyStarter(previous)) {
        result = { project: previous ?? fullDeck, hasArchive: Boolean(archived.result) }
        return
      }
      store.put(previous, 'starter-archive')
      store.put(fullDeck, 'current')
      result = { project: fullDeck, hasArchive: true, upgraded: true }
    }
    transaction.oncomplete = () => resolve(result)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function addAsset(file) {
  const key = crypto.randomUUID()
  await put('assets', key, file)
  return 'asset:' + key
}

async function assetDirectory() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle('no-ppt-media', { create: true })
}

export async function addStreamAsset(type, write) {
  const key = 'file-' + crypto.randomUUID()
  const folder = await assetDirectory()
  let output
  try {
    const handle = await folder.getFileHandle(key, { create: true })
    output = await handle.createWritable()
    await write(output)
    await output.close()
    await put('assets', key, { type })
    return 'asset:' + key
  } catch (error) {
    await output?.abort().catch(() => {})
    await folder.removeEntry(key).catch(() => {})
    throw error
  }
}

export async function getAsset(src) {
  const key = src.slice(6)
  const asset = await read('assets', key)
  if (!asset || asset instanceof Blob) return asset
  const folder = await assetDirectory()
  const handle = await folder.getFileHandle(key)
  const file = await handle.getFile()
  return file.slice(0, file.size, asset.type)
}

export async function removeAssets(sources) {
  if (!sources.length) return
  const db = await openDatabase()
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite')
    const assets = transaction.objectStore('assets')
    for (const source of sources) assets.delete(source.slice(6))
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error)
  })
  const streamed = sources.filter(source => source.startsWith('asset:file-'))
  if (streamed.length) {
    const folder = await assetDirectory()
    await Promise.all(streamed.map(source => folder.removeEntry(source.slice(6))))
  }
}

export function useMedia(src, enabled) {
  const [local, setLocal] = useState(null)
  useEffect(() => {
    if (!enabled || !src?.startsWith('asset:')) return
    let active = true
    let url
    getAsset(src).then(blob => {
      if (!active) return
      if (blob) url = URL.createObjectURL(blob)
      setLocal({ src, url })
    }).catch(() => { if (active) setLocal({ src }) })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [src, enabled])
  if (!enabled) return ''
  return src?.startsWith('asset:') ? (local?.src === src ? local.url : '') : src
}

function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function projectForExport(project) {
  const copy = structuredClone(project)
  delete copy.previews
  const embedded = new Map()
  for (const [item, key] of mediaReferences(copy)) {
    const src = item[key]
    if (!src.startsWith('asset:')) continue
    if (!embedded.has(src)) {
      const blob = await getAsset(src)
      if (!blob) throw new Error('An uploaded media file is missing from this browser.')
      embedded.set(src, await dataURL(blob))
    }
    item[key] = embedded.get(src)
  }
  return copy
}

export async function storeEmbeddedMedia(project) {
  const embedded = new Map()
  for (const [item, key] of mediaReferences(project)) {
    const src = item[key]
    if (!src.startsWith('data:')) continue
    if (!embedded.has(src)) {
      const blob = await (await fetch(src)).blob()
      embedded.set(src, await addAsset(blob))
    }
    item[key] = embedded.get(src)
  }
  return project
}

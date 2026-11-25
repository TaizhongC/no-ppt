import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js/index-native.js'
import { mediaReferences, parseProject, stripComparisonAssets } from './project'
import { addAsset, addStreamAsset, getAsset, removeAssets } from './storage'

const manifestName = 'no-ppt-package.json'
const format = 'no-ppt'
const mediaType = /^(image|video)\/[\w.+-]+$/i
const assetPath = /^\.\/media\/[\w.-]+$/
const maxJsonSize = 32 * 1024 * 1024
const streamThreshold = 32 * 1024 * 1024
const versionPath = number => 'versions/v' + number + '.json'

function localSource(source) {
  if (/^(asset:|data:)/i.test(source)) return source
  const url = new URL(source, document.baseURI)
  return url.origin === window.location.origin ? url.href : null
}

async function readMedia(source) {
  if (source.startsWith('asset:')) {
    const blob = await getAsset(source)
    if (blob) return blob
  } else {
    const response = await fetch(source)
    if (response.ok) return response.blob()
  }
  const label = source.startsWith('asset:') ? 'an uploaded file' : new URL(source).pathname
  throw new Error('Missing media: ' + label)
}

function mediaExtension(blob, source) {
  const name = blob instanceof File ? blob.name : source.split(/[?#]/)[0]
  return name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase()
    ?? ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'video/quicktime': 'mov' }[blob.type])
    ?? blob.type.split('/')[1].replace(/[^a-z0-9]/gi, '')
}

export async function packageDeck({ project, versions, activeSlide, previews, output, progress }) {
  const zip = new ZipWriter(output ?? new BlobWriter('application/zip'))
  const routes = new Map()
  const assets = []
  const displayCopies = {}

  async function packMedia(source) {
    const local = localSource(source)
    if (!local) return source
    if (routes.has(local)) return routes.get(local)
    const blob = await readMedia(local)
    const type = blob.type.split(';')[0]
    if (!mediaType.test(type)) throw new Error('Unsupported media: ' + new URL(local).pathname)
    const path = './media/' + String(assets.length + 1).padStart(4, '0') + '.' + mediaExtension(blob, local)
    await zip.add(path.slice(2), new BlobReader(blob), { level: 0 })
    assets.push({ path, type })
    routes.set(local, path)
    if (assets.length % 10 === 0) progress?.('Packing media… ' + assets.length + ' files')
    return path
  }

  async function addDeck(path, source) {
    const deck = stripComparisonAssets(structuredClone(source))
    const allPreviews = { ...previews, ...deck.previews }
    delete deck.previews
    for (const [item, key] of mediaReferences(deck)) {
      const original = item[key]
      const packed = await packMedia(original)
      item[key] = packed
      if (packed !== original && allPreviews[original] && !displayCopies[packed]) {
        displayCopies[packed] = await packMedia(allPreviews[original])
      }
    }
    await zip.add(path, new TextReader(JSON.stringify(deck)))
  }

  await addDeck('deck.json', project)
  for (const entry of versions) await addDeck(versionPath(entry.number), entry.project)
  const manifest = { format, version: 1, activeSlide, assets, previews: displayCopies,
    versions: versions.map(({ project: snapshot, ...entry }) => entry) }
  await zip.add(manifestName, new TextReader(JSON.stringify(manifest)))
  return zip.close()
}

export async function unpackDeck(file, progress) {
  const zip = new ZipReader(new BlobReader(file))
  const stored = new Map()
  const discard = () => removeAssets([...stored.values()])
  try {
    const entries = new Map()
    for (const entry of await zip.getEntries()) {
      if (entries.has(entry.filename)) throw new Error('The ZIP contains duplicate entries.')
      entries.set(entry.filename, entry)
    }
    async function json(path) {
      const entry = entries.get(path)
      if (!entry || entry.directory || entry.uncompressedSize > maxJsonSize) throw new Error('Missing or invalid ' + path)
      return JSON.parse(await entry.getData(new TextWriter(), { checkSignature: true }))
    }

    const manifest = await json(manifestName)
    if (manifest.format !== format || manifest.version !== 1 ||
      !Array.isArray(manifest.assets) || !Array.isArray(manifest.versions)) {
      throw new Error('Choose a ZIP made with Package ZIP.')
    }
    const project = parseProject(await json('deck.json'))
    const numbers = new Set()
    const versions = []
    for (const { number, message, date } of manifest.versions) {
      if (!Number.isSafeInteger(number) || number < 1 || numbers.has(number) ||
        typeof message !== 'string' || (date != null && typeof date !== 'string')) throw new Error('Invalid version history.')
      numbers.add(number)
      versions.push({ number, message, date, project: parseProject(await json(versionPath(number))) })
    }

    for (const { path, type } of manifest.assets) {
      const entry = typeof path === 'string' && entries.get(path.slice(2))
      if (!entry || !assetPath.test(path) || !mediaType.test(type) || entry.directory || stored.has(path)) {
        throw new Error('Invalid package media.')
      }
      try {
        const asset = entry.uncompressedSize > streamThreshold && navigator.storage?.getDirectory &&
          typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype.createWritable
          ? await addStreamAsset(type, output => entry.getData(output,
            { checkSignature: true, preventClose: true, useWebWorkers: false }))
          : await addAsset(await entry.getData(new BlobWriter(type), { checkSignature: true }))
        stored.set(path, asset)
      } catch (error) {
        throw new Error('Could not restore ' + path + ' (' + entry.uncompressedSize + ' bytes). ' +
          (error?.message ?? 'The archive entry could not be read.'), { cause: error })
      }
      if (stored.size % 10 === 0) progress?.('Unpacking media… ' + stored.size + ' of ' + manifest.assets.length)
    }

    const previews = Object.fromEntries(Object.entries(manifest.previews ?? {}).flatMap(([source, preview]) =>
      stored.has(source) && stored.has(preview) ? [[stored.get(source), stored.get(preview)]] : []))
    for (const deck of [project, ...versions.map(entry => entry.project)]) {
      for (const [item, key] of mediaReferences(deck)) {
        const source = item[key]
        if (stored.has(source)) item[key] = stored.get(source)
        else if (localSource(source)) throw new Error('Missing media in package: ' + source)
      }
      deck.previews = previews
      deck.editorRevision = 2
    }
    return { project, versions: versions.sort((a, b) => b.number - a.number),
      lastSlideId: project.slides[manifest.activeSlide]?.id, discard }
  } catch (error) {
    await discard().catch(() => {})
    throw error ?? new Error('Could not read the ZIP directory or presentation metadata.')
  } finally {
    await zip.close()
  }
}

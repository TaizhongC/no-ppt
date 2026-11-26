import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js'
import { mediaReferences, parseProject, stripComparisonAssets } from './project'
import { getAsset } from './storage'

const manifestName = 'no-ppt-package.json'
const format = 'no-ppt'
const mediaType = /^(image|video)\/[\w.+-]+$/i
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

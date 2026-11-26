import { createReadStream, createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, readdir, readFile, writeFile, rename, rm, stat, mkdtemp, realpath } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js/index-native.js'

const validId = /^[a-z0-9][a-z0-9-]{0,100}$/
const jsonLimit = 64 * 1024 * 1024
const mime = { '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp' }

async function atomicJson(file, data) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2))
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

function checkDeck(deck) {
  if (deck?.version !== 1 || !Array.isArray(deck.slides) || !deck.slides.length ||
      deck.slides.some(slide => !Array.isArray(slide.layers))) throw new Error('Invalid presentation JSON.')
}

function mapSources(value, transform) {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (['src', 'poster', 'thumbnail', 'reference'].includes(key) && typeof item === 'string') value[key] = transform(item)
    else if (key === 'previews' && item && typeof item === 'object') {
      value[key] = Object.fromEntries(Object.entries(item).map(([source, preview]) => [transform(source), transform(preview)]))
    } else if (typeof item === 'object') mapSources(item, transform)
  }
}

function browserDeck(deck, id) {
  const copy = structuredClone(deck)
  mapSources(copy, source => source.startsWith('./media/') ? `/presentations/${id}/${source.slice(2)}` : source)
  return copy
}

export class LocalPresentations {
  constructor(root) { this.root = path.resolve(root); this.pending = Promise.resolve() }
  folder(id) {
    if (!validId.test(id)) throw new Error('Invalid presentation folder.')
    return path.join(this.root, id)
  }
  async revision(id) {
    const folder = this.folder(id)
    const project = await readFile(path.join(folder, 'deck.json'))
    const metadata = await this.readOptional(path.join(folder, 'workspace.json'), {})
    return createHash('sha256').update(project).update(JSON.stringify(metadata)).digest('hex')
  }
  // Serialize writes so autosaves, versions and activation cannot overwrite each other.
  write(action) {
    const result = this.pending.then(action)
    this.pending = result.catch(() => {})
    return result
  }
  async list() {
    await mkdir(this.root, { recursive: true })
    const decks = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId.test(entry.name)) continue
      const folder = this.folder(entry.name)
      try {
        const project = JSON.parse(await readFile(path.join(folder, 'deck.json'), 'utf8'))
        checkDeck(project)
        const manifest = await this.readOptional(path.join(folder, 'no-ppt-package.json'), {})
        const workspace = await this.readOptional(path.join(folder, 'workspace.json'), {})
        project.previews = { ...manifest.previews, ...project.previews }
        const versions = []
        for (const version of workspace.versions ?? manifest.versions ?? []) {
          if (!Number.isSafeInteger(version.number) || version.number < 1) throw new Error('Invalid saved version.')
          const snapshot = JSON.parse(await readFile(path.join(folder, 'versions', `v${version.number}.json`), 'utf8'))
          checkDeck(snapshot)
          versions.push({ ...version, project: browserDeck(snapshot, entry.name) })
        }
        decks.push({ id: entry.name, revision: await this.revision(entry.name), project: browserDeck(project, entry.name), versions,
          lastSlideId: workspace.lastSlideId ?? project.slides[manifest.activeSlide ?? 0]?.id })
      } catch (error) { throw new Error(`Cannot open presentations/${entry.name}: ${error.message}`) }
    }
    const state = await this.readOptional(path.join(this.root, 'workspace.json'), {})
    return { decks, activeId: state.activeId }
  }
  async readOptional(file, fallback) {
    try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw error
    }
  }
  async availableId(name) {
    const base = name?.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'presentation'
    let id = base
    while (await stat(this.folder(id)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) id = base + '-' + randomUUID().slice(0, 8)
    return id
  }
  async create({ project, versions = [] }) {
    checkDeck(project)
    await mkdir(this.root, { recursive: true })
    const id = await this.availableId(project.name)
    const folder = this.folder(id)
    await mkdir(folder)
    try {
      await mkdir(path.join(folder, 'media'))
      await mkdir(path.join(folder, 'versions'))
      await atomicJson(path.join(folder, 'deck.json'), project)
      await atomicJson(path.join(folder, 'no-ppt-package.json'), { format: 'no-ppt', version: 1, assets: [], versions: [] })
      await this.save(id, { project, lastSlideId: project.slides[0]?.id, versions })
      await atomicJson(path.join(this.root, 'workspace.json'), { activeId: id })
      return (await this.list()).decks.find(deck => deck.id === id)
    } catch (error) { await rm(folder, { recursive: true, force: true }); throw error }
  }
  async unpack(archive) {
    await mkdir(this.root, { recursive: true })
    const stage = await mkdtemp(path.join(this.root, '.unpacking-'))
    const zip = new ZipReader(new BlobReader(await openAsBlob(archive)), { useWebWorkers: false })
    try {
      const entries = new Map()
      let total = 0
      for (const entry of await zip.getEntries()) {
        const name = entry.filename
        if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.') ||
            entries.has(name) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Unsafe or duplicate ZIP path.')
        total += entry.uncompressedSize
        if (total > 20 * 1024 ** 3 || entries.size > 20000) throw new Error('Package exceeds local import limits.')
        entries.set(name, entry)
      }
      async function json(name) {
        const entry = entries.get(name)
        if (!entry || entry.directory || entry.uncompressedSize > jsonLimit) throw new Error('Missing or invalid ' + name)
        return JSON.parse(await entry.getData(new TextWriter(), { checkSignature: true }))
      }
      const manifest = await json('no-ppt-package.json')
      const project = await json('deck.json')
      checkDeck(project)
      if (manifest.format !== 'no-ppt' || manifest.version !== 1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.versions)) throw new Error('Choose a ZIP made with Package ZIP.')
      const media = new Set()
      for (const asset of manifest.assets) {
        if (!/^\.\/media\/[\w.-]+$/.test(asset.path) || !/^(image|video)\/[\w.+-]+$/i.test(asset.type) ||
            media.has(asset.path) || !entries.has(asset.path.slice(2))) throw new Error('Invalid package media.')
        media.add(asset.path)
      }
      const validateSources = deck => mapSources(deck, source => {
        if (source && !/^https?:\/\//i.test(source) && !media.has(source)) throw new Error('Missing or invalid package media: ' + source)
        return source
      })
      validateSources(project)
      validateSources({ previews: manifest.previews })
      const numbers = new Set()
      for (const version of manifest.versions) {
        if (!Number.isSafeInteger(version.number) || version.number < 1 || numbers.has(version.number)) throw new Error('Invalid version history.')
        numbers.add(version.number)
        const snapshot = await json(`versions/v${version.number}.json`)
        checkDeck(snapshot)
        validateSources(snapshot)
      }
      for (const entry of entries.values()) {
        const output = path.join(stage, entry.filename)
        if (entry.directory) { await mkdir(output, { recursive: true }); continue }
        await mkdir(path.dirname(output), { recursive: true })
        await entry.getData(Writable.toWeb(createWriteStream(output, { flags: 'wx' })), { checkSignature: true })
      }
      const id = await this.availableId(project.name)
      // Never trust workspace metadata supplied inside an archive.
      await atomicJson(path.join(stage, 'workspace.json'), { lastSlideId: project.slides[manifest.activeSlide ?? 0]?.id,
        versions: manifest.versions.map(({ number, message, date }) => ({ number, message, date })) })
      await rename(stage, this.folder(id))
      await atomicJson(path.join(this.root, 'workspace.json'), { activeId: id })
      return (await this.list()).decks.find(deck => deck.id === id)
    } finally {
      await zip.close()
      await rm(stage, { recursive: true, force: true })
    }
  }
  async save(id, { project, lastSlideId, versions, revision }) {
    const folder = this.folder(id)
    if (revision !== undefined && revision !== await this.revision(id)) {
      throw new Error('This presentation changed on disk or in another tab. Reload before saving.')
    }
    await stat(path.join(folder, 'deck.json'))
    checkDeck(project)
    const store = async source => {
      await mkdir(path.join(folder, 'media'), { recursive: true })
      const deck = structuredClone(source)
      const uploads = []
      mapSources(deck, src => {
        if (src.startsWith(`/presentations/${id}/media/`)) return './media/' + src.split('/media/')[1]
        if (src.startsWith('asset:')) throw new Error('Media must be exported before saving to disk.')
        if (!src.startsWith('data:')) return src
        const match = /^data:((?:image|video)\/[\w.+-]+);base64,([\s\S]*)$/.exec(src)
        if (!match) throw new Error('Unsupported embedded media.')
        const bytes = Buffer.from(match[2], 'base64')
        const extension = Object.entries(mime).find(([, type]) => type === match[1])?.[0]
          ?? '.' + (match[1].split('/')[1].replace(/[^a-z0-9]/gi, '') || 'bin')
        const name = 'upload-' + createHash('sha256').update(bytes).digest('hex') + extension
        uploads.push(writeFile(path.join(folder, 'media', name), bytes))
        return './media/' + name
      })
      await Promise.all(uploads)
      return deck
    }
    const metadata = await this.readOptional(path.join(folder, 'workspace.json'), {})
    const manifest = await this.readOptional(path.join(folder, 'no-ppt-package.json'), {})
    if (versions) {
      await mkdir(path.join(folder, 'versions'), { recursive: true })
      for (const version of versions) {
        if (!Number.isSafeInteger(version.number) || version.number < 1) throw new Error('Invalid version.')
        await atomicJson(path.join(folder, 'versions', `v${version.number}.json`), await store(version.project))
      }
      metadata.versions = versions.map(({ project: snapshot, ...version }) => version)
      manifest.versions = metadata.versions
    }
    metadata.lastSlideId = lastSlideId
    await atomicJson(path.join(folder, 'deck.json'), await store(project))
    // Keep Package ZIP metadata usable by other copies of the editor.
    const files = await readdir(path.join(folder, 'media'))
    const oldTypes = new Map((manifest.assets ?? []).map(asset => [asset.path, asset.type]))
    manifest.assets = files.map(name => ({ path: './media/' + name,
      type: oldTypes.get('./media/' + name) || mime[path.extname(name)] || ({ svgxml: 'image/svg+xml', quicktime: 'video/quicktime' }[path.extname(name).slice(1)]) || 'application/octet-stream' }))
    manifest.activeSlide = Math.max(0, project.slides.findIndex(slide => slide.id === lastSlideId))
    await atomicJson(path.join(folder, 'no-ppt-package.json'), manifest)
    await atomicJson(path.join(folder, 'workspace.json'), metadata)
    return { saved: true, revision: await this.revision(id) }
  }
}

export function localPresentationsPlugin(root) {
  const disk = new LocalPresentations(root)
  const install = server => {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')
      if (!url.pathname.startsWith('/api/local-presentations') && !url.pathname.startsWith('/presentations/')) return next()
      const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
      let upload
      try {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Local requests only.' })
        if (url.pathname.startsWith('/presentations/')) {
          if (!['GET', 'HEAD'].includes(req.method)) return reply(405, { error: 'Read only.' })
          const relative = decodeURIComponent(url.pathname.slice('/presentations/'.length))
          if (relative.split('/').some(part => part.startsWith('.') || !part) || relative.includes('\\')) return reply(403, { error: 'Invalid path.' })
          const file = await realpath(path.join(disk.root, relative))
          if (!file.startsWith(await realpath(disk.root) + path.sep)) return reply(403, { error: 'Invalid path.' })
          const info = await stat(file)
          if (!info.isFile()) return reply(404, { error: 'File not found.' })
          let start = 0, end = info.size - 1
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
            if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end() }
            start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
            end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end
            if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end() }
          }
          res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache', 'Content-Length': Math.max(0, end - start + 1), ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) })
          if (req.method === 'HEAD' || !info.size) return res.end()
          return createReadStream(file, { start, end }).pipe(res)
        }
        if (req.method === 'GET' && url.pathname === '/api/local-presentations') {
          await disk.pending
          return reply(200, await disk.list())
        }
        if (!['POST', 'PUT'].includes(req.method) || req.headers['x-no-ppt-local'] !== '1') return reply(403, { error: 'Invalid local write request.' })
        if (req.method === 'POST' && url.pathname === '/api/local-presentations/unpack') {
          await mkdir(disk.root, { recursive: true })
          upload = path.join(disk.root, '.upload-' + randomUUID() + '.zip')
          let size = 0
          req.on('data', chunk => { size += chunk.length; if (size > 20 * 1024 ** 3) req.destroy(new Error('ZIP is too large.')) })
          await pipeline(req, createWriteStream(upload, { flags: 'wx' }))
          const deck = await disk.write(() => disk.unpack(upload))
          return reply(200, deck)
        }
        const chunks = []
        let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > jsonLimit) throw new Error('Save exceeds local JSON limit.'); chunks.push(chunk) }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (req.method === 'POST' && url.pathname === '/api/local-presentations/create') {
          const deck = await disk.write(() => disk.create(body))
          return reply(200, deck)
        }
        const match = /^\/api\/local-presentations\/([a-z0-9-]+)$/.exec(url.pathname)
        if (req.method === 'PUT' && match) {
          if (typeof body.revision !== 'string') return reply(409, { error: 'Reload the app before saving this presentation.' })
          return reply(200, await disk.write(() => disk.save(match[1], body)))
        }
        if (req.method === 'POST' && url.pathname === '/api/local-presentations/activate') {
          await stat(path.join(disk.folder(body.id), 'deck.json'))
          await disk.write(() => atomicJson(path.join(disk.root, 'workspace.json'), { activeId: body.id }))
          return reply(200, { saved: true })
        }
        reply(404, { error: 'Unknown local presentation request.' })
      } catch (error) {
        if (!res.headersSent) reply(error.code === 'ENOENT' ? 404 : 400, { error: error.message })
        else res.destroy(error)
      } finally { if (upload) await rm(upload, { force: true }) }
    })
  }
  return { name: 'local-presentations', configureServer: install, configurePreviewServer: install }
}

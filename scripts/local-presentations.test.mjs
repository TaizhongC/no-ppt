import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BlobWriter, ZipWriter, TextReader, Uint8ArrayReader } from '@zip.js/zip.js/index-native.js'
import { createServer } from 'vite'
import { LocalPresentations, localPresentationsPlugin } from './local-presentations.mjs'

const project = { version: 1, name: 'Test Deck', slides: [{ id: 'slide-1', layers: [{ type: 'image', src: './media/sample.mp4' }, { type: 'text', text: 'Original' }] }] }
const manifest = { format: 'no-ppt', version: 1, activeSlide: 0, assets: [{ path: './media/sample.mp4', type: 'video/mp4' }], versions: [{ number: 1, message: 'Original' }] }
async function archive(entries = {}) {
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false })
  for (const [name, value] of Object.entries({ 'deck.json': project, 'no-ppt-package.json': manifest, 'versions/v1.json': project, ...entries })) {
    await zip.add(name, new TextReader(JSON.stringify(value)))
  }
  await zip.add('media/sample.mp4', new Uint8ArrayReader(Uint8Array.from([0, 1, 2, 3, 4, 5])))
  return new Uint8Array(await (await zip.close()).arrayBuffer())
}

test('ZIP import, disk autosave, restart recovery, versions, duplicate imports and streamed HTTP media', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'no-ppt-test-'))
  let server
  try {
    server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 }, plugins: [localPresentationsPlugin(path.join(root, 'presentations'))] })
    await server.listen()
    const base = 'http://127.0.0.1:' + server.httpServer.address().port
    const headers = { 'X-No-Ppt-Local': '1', 'Content-Type': 'application/zip' }
    const createdResponse = await fetch(base + '/api/local-presentations/create', { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: { ...project, name: 'New Presentation', slides: [{ id: 'new-slide', layers: [] }] } }) })
    assert.equal(createdResponse.status, 200)
    const created = await createdResponse.json()
    assert.equal(created.id, 'new-presentation')
    const createdFolder = path.join(root, 'presentations', created.id)
    assert.deepEqual((await readdir(createdFolder)).sort(), ['deck.json', 'media', 'no-ppt-package.json', 'versions', 'workspace.json'])
    const response = await fetch(base + '/api/local-presentations/unpack', { method: 'POST', headers, body: await archive() })
    assert.equal(response.status, 200)
    const imported = await response.json()
    assert.equal(imported.id, 'test-deck')
    assert.equal(imported.versions.length, 1)
    assert.equal(imported.project.slides[0].layers[0].src, '/presentations/test-deck/media/sample.mp4')
    const directory = path.join(root, 'presentations', imported.id)
    assert.deepEqual([...await readFile(path.join(directory, 'media/sample.mp4'))], [0, 1, 2, 3, 4, 5])
    const seek = await fetch(base + imported.project.slides[0].layers[0].src, { headers: { Range: 'bytes=2-4' } })
    assert.equal(seek.status, 206)
    assert.equal(seek.headers.get('content-range'), 'bytes 2-4/6')
    assert.deepEqual([...new Uint8Array(await seek.arrayBuffer())], [2, 3, 4])
    imported.project.slides[0].layers[1].text = '已修改'
    imported.project.slides[0].layers.push({ type: 'image', src: 'data:image/png;base64,AQID' })
    const saveBody = { project: imported.project, lastSlideId: 'slide-1', revision: imported.revision }
    const saved = await fetch(base + '/api/local-presentations/test-deck', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(saveBody) })
    assert.equal(saved.status, 200)
    const staleSave = await fetch(base + '/api/local-presentations/test-deck', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(saveBody) })
    assert.equal(staleSave.status, 400)
    const diskJson = JSON.parse(await readFile(path.join(directory, 'deck.json')))
    assert.equal(diskJson.slides[0].layers[1].text, '已修改')
    assert.equal(diskJson.slides[0].layers[0].src, './media/sample.mp4')
    assert.match(diskJson.slides[0].layers[2].src, /^\.\/media\/upload-/)
    assert.equal(JSON.parse(await readFile(path.join(directory, 'versions/v1.json'))).slides[0].layers[1].text, 'Original')
    await server.close()
    server = null
    const restarted = new LocalPresentations(path.join(root, 'presentations'))
    const recovered = await restarted.list()
    assert.equal(recovered.activeId, 'test-deck')
    assert.equal(recovered.decks.find(deck => deck.id === imported.id).project.slides[0].layers[1].text, '已修改')
    const archivePath = path.join(root, 'duplicate.zip')
    await writeFile(archivePath, await archive())
    const second = await restarted.unpack(archivePath)
    assert.notEqual(second.id, imported.id)
    assert.equal((await restarted.list()).decks.length, 3)
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }) }
})

test('malformed packages never publish a partial presentation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'no-ppt-invalid-'))
  try {
    const disk = new LocalPresentations(path.join(root, 'presentations'))
    for (const entries of [{ 'deck.json': { version: 1, slides: [] } }, { 'no-ppt-package.json': { ...manifest, assets: [{ path: '../escape', type: 'image/png' }] } }, { 'deck.json': { ...project, slides: [{ layers: [{ type: 'image', src: './media/missing.png' }] }] } }]) {
      const file = path.join(root, 'invalid.zip')
      await writeFile(file, await archive(entries))
      await assert.rejects(disk.unpack(file))
      assert.deepEqual(await readdir(disk.root), [])
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

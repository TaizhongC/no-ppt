import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { localLibraryIndex } from '../src/presentationLibrary.js'

test('old browser copy with three versions cannot duplicate the local deck with Chinese v4', () => {
  const existing = { activeId: 'old-browser-id', legacyVersionsDeckId: 'old-browser-id', decks: [
    { id: 'old-browser-id', name: 'AI Tectonism', slideCount: 135 },
    { id: 'ai-tectonism', name: 'AI Tectonism（中文版）', slideCount: 135 },
  ] }
  const before = structuredClone(existing)
  const local = { activeId: 'ai-tectonism', decks: [{ id: 'ai-tectonism',
    project: { name: 'AI Tectonism', slides: Array.from({ length: 135 }, () => ({ layers: [] })) },
    versions: [{ number: 4, message: '中文版' }, { number: 3 }, { number: 2 }, { number: 1 }],
    lastSlideId: 'last-slide',
  }] }
  const result = localLibraryIndex(existing, local)
  assert.deepEqual(result.library.decks.map(deck => deck.id), ['ai-tectonism'])
  assert.equal(result.library.activeId, 'ai-tectonism')
  assert.equal(result.library.decks[0].name, 'AI Tectonism')
  assert.equal(result.library.decks[0].slideCount, 135)
  assert.equal(result.archiveBrowserLibrary, true)
  assert.deepEqual(existing, before)
  assert.equal(local.decks[0].versions.length, 4)
  const reloaded = localLibraryIndex(result.library, local)
  assert.deepEqual(reloaded.library, result.library)
  assert.equal(reloaded.archiveBrowserLibrary, false)
})

test('distinct presentation folders remain separate and invalid active IDs fall back to a disk deck', () => {
  const local = { activeId: 'missing', decks: [
    { id: 'first', project: { name: 'Same title', slides: [{}] } },
    { id: 'second', project: { name: 'Same title', slides: [{}] } },
  ] }
  const { library } = localLibraryIndex({ activeId: 'old-browser-id', decks: [] }, local)
  assert.deepEqual(library.decks.map(deck => deck.id), ['first', 'second'])
  assert.equal(library.activeId, 'first')
})

test('AI Tectonism preserves English v3 and the corrected Chinese translation in v4', {
  skip: !existsSync(new URL('../presentations/ai-tectonism/deck.json', import.meta.url)),
}, async () => {
  const project = JSON.parse(await readFile(new URL('../presentations/ai-tectonism/deck.json', import.meta.url), 'utf8'))
  const v3 = JSON.parse(await readFile(new URL('../presentations/ai-tectonism/versions/v3.json', import.meta.url), 'utf8'))
  const v4 = JSON.parse(await readFile(new URL('../presentations/ai-tectonism/versions/v4.json', import.meta.url), 'utf8'))
  assert.equal(project.name, 'AI Tectonism')
  assert.ok(v3.slides[0].layers.some(layer => layer.text?.includes('Computation & Design Group')))
  assert.ok(v4.slides[0].layers.some(layer => layer.text?.includes('陈太中') && layer.text.includes('计算与设计团队')))
  const text = v4.slides.flatMap(slide => slide.layers.map(layer => layer.text ?? '')).join('\n')
  for (const expected of ['三维静力学 层压结构', '独角兽岛，成都', '丽泽SOHO，北京', '亨得森塔，香港', '大湾区全民健身中心，广州', '材料高效利用']) {
    assert.ok(text.includes(expected), 'Missing translation: ' + expected)
  }
})

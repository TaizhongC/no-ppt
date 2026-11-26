const diskIds = new Set()
const revisions = new Map()
const saves = new Map()
function remember(deck) { diskIds.add(deck.id); revisions.set(deck.id, deck.revision) }

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Local file storage requires npm run dev or npm run preview. Restart the app with its local server.')
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Local presentation storage failed.')
  return data
}

export async function listLocalPresentations() {
  const response = await fetch('/api/local-presentations')
  // Static hosting can still open older browser-only decks.
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not read presentations/.')
  for (const deck of data.decks) remember(deck)
  return data
}

export async function unpackLocalPresentation(file) {
  const deck = await request('/api/local-presentations/unpack', {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-No-Ppt-Local': '1' }, body: file,
  })
  remember(deck)
  return deck
}

export const isDiskPresentation = id => diskIds.has(id)
export async function createLocalPresentation(project, versions) {
  const deck = await request('/api/local-presentations/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-No-Ppt-Local': '1' }, body: JSON.stringify({ project, versions }),
  })
  remember(deck)
  return deck
}
export function saveLocalPresentation(id, data) {
  const save = (saves.get(id) ?? Promise.resolve()).then(async () => {
    const result = await request('/api/local-presentations/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-No-Ppt-Local': '1' },
      body: JSON.stringify({ ...data, revision: revisions.get(id) }),
    })
    revisions.set(id, result.revision)
    return result
  })
  saves.set(id, save.catch(() => {}))
  return save
}
export function activateLocalPresentation(id) {
  return request('/api/local-presentations/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-No-Ppt-Local': '1' }, body: JSON.stringify({ id }),
  })
}

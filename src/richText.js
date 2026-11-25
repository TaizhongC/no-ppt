const normalize = text => text.replace(/\r\n/g, '\n')
const plainParagraphs = layer => layer.text.split('\n').map(text => ({
  runs: [{ text, weight: layer.weight, italic: layer.italic }],
}))

function getParagraphs(layer) {
  const raw = layer.paragraphs
  if (!raw?.length) return plainParagraphs(layer)
  const paragraphs = raw.map(p => ({ ...p, runs: p.runs.map(run => ({ ...run })) }))
  const original = paragraphs.map(p => p.runs.map(run => run.text).join('')).join('\n')
  if (original === layer.text) return paragraphs
  // Earlier imports trimmed the text field while retaining edge whitespace in their runs.
  if (original.trim() !== layer.text) return plainParagraphs(layer)
  const withoutTrailing = spliceRuns(paragraphs, original.trimEnd().length, original.length, '')
  return spliceRuns(withoutTrailing, 0, original.length - original.trimStart().length, '')
}

function segments(paragraphs) {
  return paragraphs.flatMap(({ runs, ...style }, index) => [
    ...(index ? [{ boundary: style, text: '\n' }] : []),
    ...runs.filter(run => run.text),
  ])
}

function sliceRuns(runs, from, to) {
  let offset = 0
  const result = []
  for (const run of runs) {
    const end = offset + run.text.length
    if (end > from && offset < to) {
      result.push({ ...run, text: run.text.slice(Math.max(0, from - offset), to - offset) })
    }
    offset = end
  }
  return result
}

function rebuild(first, nodes) {
  const paragraphs = [{ ...first, runs: [] }]
  for (const node of nodes) {
    if (node.boundary) paragraphs.push({ ...node.boundary, runs: [] })
    else paragraphs.at(-1).runs.push(node)
  }
  return paragraphs
}

function spliceRuns(paragraphs, from, to, inserted) {
  const nodes = segments(paragraphs)
  const left = sliceRuns(nodes, 0, from)
  const right = sliceRuns(nodes, to, Infinity)
  const { text: ignored, boundary: ignoredBoundary, ...format } = [left.at(-1), right[0]]
    .find(node => node && !node.boundary) ?? {}
  const originalStyle = [...left].reverse().find(node => node.boundary)?.boundary ?? paragraphs[0]
  const { runs: ignoredRuns, ...style } = originalStyle
  return rebuild(paragraphs[0], [...left, ...inserted.split('\n').flatMap((text, index) => [
    ...(index ? [{ boundary: style, text: '\n' }] : []), ...(text ? [{ ...format, text }] : []),
  ]), ...right])
}

export function editTextRuns(layer, text) {
  text = normalize(text)
  if (!layer.paragraphs?.length) return { text }
  const previous = layer.text
  let start = 0
  while (start < Math.min(previous.length, text.length) && previous[start] === text[start]) start++
  let tail = 0
  while (tail < Math.min(previous.length, text.length) - start &&
    previous[previous.length - tail - 1] === text[text.length - tail - 1]) tail++
  return { text, paragraphs: spliceRuns(getParagraphs(layer), start, previous.length - tail, text.slice(start, text.length - tail)) }
}

export function formatTextRuns(layer, from, to, key, enabled, disabled) {
  if (from === to) {
    const value = layer[key] === enabled ? disabled : enabled
    return uniformTextRuns(layer, key, value)
  }
  const paragraphs = getParagraphs(layer)
  const nodes = segments(paragraphs)
  const selection = sliceRuns(nodes, from, to)
  const value = selection.filter(run => !run.boundary).every(run => (run[key] ?? layer[key]) === enabled)
    ? disabled : enabled
  return { paragraphs: rebuild(paragraphs[0], [
    ...sliceRuns(nodes, 0, from),
    ...selection.map(run => run.boundary ? run : { ...run, [key]: value }),
    ...sliceRuns(nodes, to, Infinity),
  ]) }
}

export function uniformTextRuns(layer, key, value) {
  return { [key]: value, paragraphs: layer.paragraphs?.map(p => ({
    ...p, runs: p.runs.map(run => ({ ...run, [key]: value })),
  })) }
}

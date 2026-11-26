// Once local decks exist, folders define the visible library. Browser-only
// imports can have regenerated IDs and edited layouts, so content comparison
// cannot reliably identify the old copy of a local presentation.
export function localLibraryIndex(existing, local) {
  const ids = new Set(local.decks.map(deck => deck.id))
  const decks = local.decks.map(({ id, project, lastSlideId }) => ({
    id, name: project.name?.trim() || 'Untitled presentation',
    slideCount: project.slides.length, lastSlideId,
  }))
  const activeId = ids.has(local.activeId) ? local.activeId
    : ids.has(existing?.activeId) ? existing.activeId : decks[0]?.id
  return {
    library: { ...existing, decks, activeId },
    archiveBrowserLibrary: Boolean(existing?.decks.some(deck => !ids.has(deck.id))),
  }
}

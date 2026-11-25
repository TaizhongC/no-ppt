function accentInk(color) {
  const hex = color.length === 4 ? [...color.slice(1)].map(channel => channel.repeat(2)).join('') : color.slice(1)
  const [red, green, blue] = [0, 2, 4].map(index => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.179 ? '#000000' : '#ffffff'
}

export async function applyAppTheme() {
  try {
    const response = await fetch('./no-ppt.config', { cache: 'no-cache' })
    if (!response.ok) return
    const config = await response.text()
    const accent = /^\s*accent\s*=\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*$/im.exec(config)?.[1]
    if (!accent) return
    document.documentElement.style.setProperty('--theme-accent', accent)
    document.documentElement.style.setProperty('--on-accent', accentInk(accent))
  } catch {
    // The stylesheet uses the default accent when the config is unavailable.
  }
}

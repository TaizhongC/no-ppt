const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])
const embedHosts = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com'])

function startTime(value) {
  if (!value) return 0
  if (/^\d+$/.test(value)) return Number(value)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value)
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0
}

export function youtubeVideo(src) {
  let url
  try { url = new URL(src) } catch { return null }
  if (!['https:', 'http:'].includes(url.protocol)) return null
  const [path, part] = url.pathname.split('/').filter(Boolean)
  let id
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') id = path
  else if (youtubeHosts.has(url.hostname)) {
    if (path === 'watch') id = url.searchParams.get('v')
    else if (['embed', 'shorts', 'live'].includes(path)) id = part
  } else if (embedHosts.has(url.hostname) && path === 'embed') id = part
  if (!id || !/^[\w-]{11}$/.test(id)) return null

  const time = startTime(url.searchParams.get('start') || url.searchParams.get('t'))
  const parameters = new URLSearchParams({ playsinline: '1' })
  if (time > 0 && Number.isSafeInteger(time)) parameters.set('start', time)
  const watch = new URL('https://www.youtube.com/watch')
  watch.searchParams.set('v', id)
  if (parameters.has('start')) watch.searchParams.set('t', time)
  return { embed: 'https://www.youtube.com/embed/' + id + '?' + parameters, watch: watch.href,
    preview: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', start: parameters.has('start') ? time : 0 }
}

let playerAPI

export function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  playerAPI ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const previous = window.onYouTubeIframeAPIReady
    const timer = window.setTimeout(fail, 12000)
    function finish() {
      window.clearTimeout(timer)
      window.onYouTubeIframeAPIReady = previous
    }
    function fail() {
      finish()
      script.remove()
      reject(new Error('The YouTube player could not load.'))
    }
    window.onYouTubeIframeAPIReady = () => {
      finish()
      resolve(window.YT)
      previous?.()
    }
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = fail
    document.head.append(script)
  }).catch(error => {
    playerAPI = undefined
    throw error
  })
  return playerAPI
}

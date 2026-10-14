/** Media permission checks for the in-app Tavus call. */

function callPermissionAllowed(requestingUrl, permission, appOrigin) {
  if (permission !== 'media' && permission !== 'display-capture') {
    return false
  }

  let host = ''
  let origin = ''

  try {
    const url = new URL(String(requestingUrl || ''))
    host = url.hostname
    origin = url.origin
  } catch {
    return false
  }

  if (host === 'daily.co' || host.endsWith('.daily.co')) {
    return true
  }

  if (appOrigin && origin === appOrigin) {
    return true
  }

  return host === 'localhost' || host === '127.0.0.1'
}

module.exports = { callPermissionAllowed }

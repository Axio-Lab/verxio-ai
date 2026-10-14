function isCloudDashboardPath(path) {
  return path.startsWith('/api/cron') || path.startsWith('/api/messaging') || path.startsWith('/api/pairing')
}

function isDesktopGatewayPath(path) {
  const value = String(path || '')
  return value.startsWith('/api/messaging') || value.startsWith('/api/pairing')
}

function localGatewayPath(path) {
  const value = String(path || '')
  const queryAt = value.indexOf('?')
  const pathname = queryAt === -1 ? value : value.slice(0, queryAt)
  const search = queryAt === -1 ? '' : value.slice(queryAt)

  if (pathname === '/api/messaging/webhooks' || pathname.startsWith('/api/messaging/webhooks/')) {
    return `/api/webhooks${pathname.slice('/api/messaging/webhooks'.length)}${search}`
  }

  return value
}

function resolveHermesApiTarget({ path, scope, hasLocalHermes }) {
  if (hasLocalHermes && isDesktopGatewayPath(path)) {
    return 'local'
  }

  if (scope === 'cloud' || isCloudDashboardPath(path)) {
    return 'cloud'
  }

  return hasLocalHermes ? 'local' : 'proxy'
}

module.exports = {
  isCloudDashboardPath,
  isDesktopGatewayPath,
  localGatewayPath,
  resolveHermesApiTarget
}

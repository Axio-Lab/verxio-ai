import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, Lock, LogIn } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { authLogin, authMe, authSignup, verxioApiEnabled, type VerxioAuthResponse } from '@/lib/verxio-api'

type AuthMode = 'login' | 'signup'
type AuthStatus = 'checking' | 'authenticated' | 'guest'

interface VerxioAuthGateProps {
  children: ReactNode
}

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('Invalid email or password')) {
    return 'Email or password is incorrect.'
  }

  if (message.includes('already exists')) {
    return 'An account with this email already exists.'
  }

  if (message.includes('Password must be at least')) {
    return 'Password must be at least 8 characters.'
  }

  return 'Verxio could not complete this request. Check the API server and try again.'
}

export function VerxioAuthGate({ children }: VerxioAuthGateProps) {
  const enabled = verxioApiEnabled()
  const [status, setStatus] = useState<AuthStatus>(enabled ? 'checking' : 'authenticated')
  const [mode, setMode] = useState<AuthMode>('login')
  const [auth, setAuth] = useState<VerxioAuthResponse | null>(null)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false

    authMe()
      .then(result => {
        if (cancelled) {
          return
        }

        setAuth(result)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) {
          return
        }

        setStatus('guest')
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  const title = mode === 'login' ? 'Sign in to Verxio' : 'Create your Verxio workspace'
  const actionLabel = mode === 'login' ? 'Sign in' : 'Create workspace'
  const passwordAutocomplete = mode === 'login' ? 'current-password' : 'new-password'

  const canSubmit = useMemo(() => {
    return email.trim().includes('@') && password.length >= (mode === 'login' ? 1 : 8)
  }, [email, mode, password])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      setError(mode === 'login' ? 'Enter your email and password.' : 'Use a valid email and an 8 character password.')

      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const result =
        mode === 'login'
          ? await authLogin(email.trim(), password)
          : await authSignup(email.trim(), password, displayName.trim())

      setAuth(result)
      setStatus('authenticated')
    } catch (submitError) {
      setError(readableAuthError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  if (!enabled || status === 'authenticated') {
    return <>{children}</>
  }

  if (status === 'checking') {
    return (
      <div className="grid min-h-dvh bg-background text-foreground">
        <PageLoader label="Checking Verxio session" />
      </div>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark className="size-10" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-normal">{title}</h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {auth?.workspace.name || 'Your workspace opens after authentication.'}
            </p>
          </div>
        </div>

        <form aria-busy={submitting} className="space-y-4" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="verxio-display-name">
                Name
              </label>
              <Input
                autoComplete="name"
                id="verxio-display-name"
                onChange={event => setDisplayName(event.target.value)}
                placeholder="Donatus Prince"
                spellCheck={false}
                value={displayName}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="verxio-email">
              Email
            </label>
            <Input
              aria-describedby={error ? 'verxio-auth-error' : undefined}
              aria-invalid={error ? 'true' : undefined}
              autoComplete="email"
              id="verxio-email"
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
              spellCheck={false}
              type="email"
              value={email}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="verxio-password">
              Password
            </label>
            <div className="relative">
              <Input
                aria-describedby={error ? 'verxio-auth-error' : undefined}
                aria-invalid={error ? 'true' : undefined}
                autoComplete={passwordAutocomplete}
                className="pr-10"
                id="verxio-password"
                onChange={event => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <Button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                onClick={() => setShowPassword(current => !current)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {mode === 'signup' && <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>}
          </div>

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              id="verxio-auth-error"
              role="alert"
            >
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button className="min-h-10 w-full" disabled={submitting} size="lg" type="submit">
            <LogIn aria-hidden="true" className={cn('size-4', submitting && 'animate-pulse')} />
            {submitting ? 'Working...' : actionLabel}
          </Button>
        </form>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          {mode === 'login' ? 'New to Verxio?' : 'Already have a workspace?'}{' '}
          <Button
            className="align-baseline"
            onClick={() => {
              setError(null)
              setMode(current => (current === 'login' ? 'signup' : 'login'))
            }}
            size="inline"
            type="button"
            variant="textStrong"
          >
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </Button>
        </div>
      </section>
    </main>
  )
}

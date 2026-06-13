import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { LOGIN_ROUTE, NEW_CHAT_ROUTE, SIGNOUT_ROUTE, SIGNUP_ROUTE } from '@/app/routes'
import { BrandMark } from '@/components/brand-mark'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, KeyRound, Lock, LogIn, RefreshCw } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  authForgotPassword,
  authLogin,
  authLogout,
  authMe,
  authRequestLoginCode,
  authResendVerification,
  authResetPassword,
  authSignup,
  authVerifyEmail,
  authVerifyLoginCode,
  verxioApiEnabled,
  type VerxioAuthCodePurpose,
  type VerxioAuthResponse
} from '@/lib/verxio-api'

type AuthMode = 'code-login' | 'password-login' | 'signup' | 'forgot-password'
type AuthStatus = 'checking' | 'authenticated' | 'guest'

interface VerxioAuthGateProps {
  children: ReactNode
}

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('Invalid email or password')) {
    return 'Email or password is incorrect.'
  }

  if (message.includes('Invalid or expired code')) {
    return 'That code is incorrect or expired.'
  }

  if (message.includes('already exists')) {
    return 'An account with this email already exists.'
  }

  if (message.includes('Verify your email')) {
    return 'Verify your email before signing in.'
  }

  if (message.includes('Password must be at least')) {
    return 'Password must be at least 8 characters.'
  }

  return 'Verxio could not complete this request. Check the API server and try again.'
}

function cleanCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

function isAuthRoute(pathname: string): boolean {
  return pathname === LOGIN_ROUTE || pathname === SIGNUP_ROUTE
}

function routeDefaultMode(pathname: string): AuthMode {
  return pathname === SIGNUP_ROUTE ? 'signup' : 'code-login'
}

function routeForMode(mode: AuthMode): string {
  return mode === 'signup' ? SIGNUP_ROUTE : LOGIN_ROUTE
}

function modeTitle(mode: AuthMode, pendingPurpose: VerxioAuthCodePurpose | null): string {
  if (pendingPurpose === 'email_verify') {
    return 'Verify your email'
  }

  if (pendingPurpose === 'login') {
    return 'Enter your login code'
  }

  if (pendingPurpose === 'password_reset') {
    return 'Set a new password'
  }

  if (mode === 'signup') {
    return 'Create your Verxio workspace'
  }

  if (mode === 'password-login') {
    return 'Sign in with password'
  }

  if (mode === 'forgot-password') {
    return 'Reset your password'
  }

  return 'Sign in to Verxio'
}

function modeSubtitle(mode: AuthMode, pendingPurpose: VerxioAuthCodePurpose | null): string {
  if (pendingPurpose === 'email_verify') {
    return 'Enter the six digit code sent to your email.'
  }

  if (pendingPurpose === 'login') {
    return 'Use your one-time code to open your workspace.'
  }

  if (pendingPurpose === 'password_reset') {
    return 'Confirm the code and choose a new password.'
  }

  if (mode === 'signup') {
    return 'Your workspace opens after email verification.'
  }

  if (mode === 'forgot-password') {
    return 'We will send a reset code to your inbox.'
  }

  return 'Use an email code or your password.'
}

export function VerxioAuthGate({ children }: VerxioAuthGateProps) {
  const enabled = verxioApiEnabled()
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<AuthStatus>(enabled ? 'checking' : 'authenticated')
  const [mode, setMode] = useState<AuthMode>(() => routeDefaultMode(location.pathname))
  const [pendingPurpose, setPendingPurpose] = useState<VerxioAuthCodePurpose | null>(null)
  const [auth, setAuth] = useState<VerxioAuthResponse | null>(null)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

        if (isAuthRoute(location.pathname)) {
          navigate(NEW_CHAT_ROUTE, { replace: true })
        }
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
  }, [enabled, location.pathname, navigate])

  useEffect(() => {
    if (!enabled || status !== 'guest' || isAuthRoute(location.pathname)) {
      return
    }

    navigate(LOGIN_ROUTE, { replace: true })
  }, [enabled, location.pathname, navigate, status])

  useEffect(() => {
    if (!enabled || status !== 'guest' || pendingPurpose || !isAuthRoute(location.pathname)) {
      return
    }

    const nextMode = routeDefaultMode(location.pathname)

    if (location.pathname === SIGNUP_ROUTE && mode !== 'signup') {
      setMode(nextMode)
      setCode('')
      setPassword('')
      setError(null)
      setNotice(null)
    }

    if (location.pathname === LOGIN_ROUTE && mode === 'signup') {
      setMode(nextMode)
      setCode('')
      setPassword('')
      setError(null)
      setNotice(null)
    }
  }, [enabled, location.pathname, mode, pendingPurpose, status])

  useEffect(() => {
    if (!enabled || status !== 'authenticated' || location.pathname !== SIGNOUT_ROUTE) {
      return
    }

    let cancelled = false

    authLogout()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) {
          return
        }

        setAuth(null)
        setStatus('guest')
        navigate(LOGIN_ROUTE, { replace: true })
      })

    return () => {
      cancelled = true
    }
  }, [enabled, location.pathname, navigate, status])

  const title = modeTitle(mode, pendingPurpose)
  const subtitle = modeSubtitle(mode, pendingPurpose)
  const normalizedEmail = email.trim()
  const isEmailValid = normalizedEmail.includes('@')

  const passwordAutocomplete =
    mode === 'password-login' && !pendingPurpose
      ? 'current-password'
      : pendingPurpose === 'password_reset' || mode === 'signup'
        ? 'new-password'
        : 'current-password'

  const canSubmit = useMemo(() => {
    if (pendingPurpose === 'email_verify' || pendingPurpose === 'login') {
      return isEmailValid && code.length === 6
    }

    if (pendingPurpose === 'password_reset') {
      return isEmailValid && code.length === 6 && password.length >= 8
    }

    if (mode === 'signup') {
      return isEmailValid && displayName.trim().length > 0 && password.length >= 8
    }

    if (mode === 'password-login') {
      return isEmailValid && password.length > 0
    }

    return isEmailValid
  }, [code.length, displayName, isEmailValid, mode, password.length, pendingPurpose])

  function resetMode(nextMode: AuthMode) {
    setMode(nextMode)
    setPendingPurpose(null)
    setCode('')
    setPassword('')
    setError(null)
    setNotice(null)

    const nextRoute = routeForMode(nextMode)

    if (location.pathname !== nextRoute) {
      navigate(nextRoute, { replace: true })
    }
  }

  function completeAuth(result: VerxioAuthResponse) {
    setAuth(result)
    setStatus('authenticated')
    navigate(NEW_CHAT_ROUTE, { replace: true })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      setError('Complete the required fields to continue.')

      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      if (pendingPurpose === 'email_verify') {
        completeAuth(await authVerifyEmail(normalizedEmail, code))

        return
      }

      if (pendingPurpose === 'login') {
        completeAuth(await authVerifyLoginCode(normalizedEmail, code))

        return
      }

      if (pendingPurpose === 'password_reset') {
        completeAuth(await authResetPassword(normalizedEmail, code, password))

        return
      }

      if (mode === 'signup') {
        const challenge = await authSignup(normalizedEmail, password, displayName.trim())
        setEmail(challenge.email)
        setPendingPurpose(challenge.purpose)
        setCode('')
        setNotice('Verification code sent.')

        return
      }

      if (mode === 'password-login') {
        completeAuth(await authLogin(normalizedEmail, password))

        return
      }

      if (mode === 'forgot-password') {
        const challenge = await authForgotPassword(normalizedEmail)
        setEmail(challenge.email)
        setPendingPurpose(challenge.purpose)
        setCode('')
        setPassword('')
        setNotice('Reset code sent.')

        return
      }

      const challenge = await authRequestLoginCode(normalizedEmail)
      setEmail(challenge.email)
      setPendingPurpose(challenge.purpose)
      setCode('')
      setNotice(challenge.purpose === 'email_verify' ? 'Verification code sent.' : 'Login code sent.')
    } catch (submitError) {
      const message = readableAuthError(submitError)

      if (mode === 'password-login' && message.includes('Verify your email')) {
        resetMode('code-login')
        setPendingPurpose('email_verify')
        setCode('')
        setNotice('Verification code sent.')
        setError(null)

        return
      }

      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    if (!pendingPurpose || !isEmailValid) {
      return
    }

    setResending(true)
    setError(null)
    setNotice(null)

    try {
      const challenge =
        pendingPurpose === 'password_reset'
          ? await authForgotPassword(normalizedEmail)
          : pendingPurpose === 'email_verify'
            ? await authResendVerification(normalizedEmail)
            : await authRequestLoginCode(normalizedEmail)

      setEmail(challenge.email)
      setPendingPurpose(challenge.purpose)
      setCode('')
      setNotice('New code sent.')
    } catch (resendError) {
      setError(readableAuthError(resendError))
    } finally {
      setResending(false)
    }
  }

  if (!enabled || (status === 'authenticated' && location.pathname !== SIGNOUT_ROUTE)) {
    return <>{children}</>
  }

  if (status === 'authenticated' && location.pathname === SIGNOUT_ROUTE) {
    return (
      <div className="grid min-h-dvh bg-background text-foreground">
        <PageLoader label="Signing out of Verxio" />
      </div>
    )
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
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{auth?.workspace.name || subtitle}</p>
          </div>
        </div>

        <form aria-busy={submitting} className="space-y-4" onSubmit={handleSubmit}>
          {mode === 'signup' && !pendingPurpose && (
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
              readOnly={Boolean(pendingPurpose)}
              spellCheck={false}
              type="email"
              value={email}
            />
          </div>

          {pendingPurpose && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="verxio-code">
                Code
              </label>
              <Input
                aria-describedby={error ? 'verxio-auth-error' : undefined}
                aria-invalid={error ? 'true' : undefined}
                autoComplete="one-time-code"
                id="verxio-code"
                inputMode="numeric"
                onChange={event => setCode(cleanCode(event.target.value))}
                pattern="[0-9]*"
                placeholder="123456"
                spellCheck={false}
                type="text"
                value={code}
              />
            </div>
          )}

          {(mode === 'signup' || mode === 'password-login' || pendingPurpose === 'password_reset') &&
            pendingPurpose !== 'email_verify' &&
            pendingPurpose !== 'login' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="verxio-password">
                  {pendingPurpose === 'password_reset' ? 'New password' : 'Password'}
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
                {(mode === 'signup' || pendingPurpose === 'password_reset') && (
                  <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
                )}
              </div>
            )}

          {notice && !error && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
              <KeyRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

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

          <Button className="min-h-10 w-full" disabled={!canSubmit || submitting} size="lg" type="submit">
            <LogIn aria-hidden="true" className={cn('size-4', submitting && 'animate-pulse')} />
            {submitting
              ? 'Working...'
              : pendingPurpose === 'email_verify'
                ? 'Verify and continue'
                : pendingPurpose === 'login'
                  ? 'Sign in with code'
                  : pendingPurpose === 'password_reset'
                    ? 'Reset password'
                    : mode === 'signup'
                      ? 'Create workspace'
                      : mode === 'forgot-password'
                        ? 'Send reset code'
                        : mode === 'password-login'
                          ? 'Sign in'
                          : 'Send login code'}
          </Button>
        </form>

        {pendingPurpose && (
          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <Button
              className="min-h-10"
              disabled={resending}
              onClick={handleResend}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className={cn('size-3.5', resending && 'animate-spin')} />
              {resending ? 'Sending...' : 'Resend code'}
            </Button>
            <Button
              onClick={() => resetMode(routeDefaultMode(location.pathname))}
              size="inline"
              type="button"
              variant="textStrong"
            >
              Use another email
            </Button>
          </div>
        )}

        {!pendingPurpose && (
          <div className="mt-4 space-y-2 text-center text-xs text-muted-foreground">
            {mode !== 'code-login' && mode !== 'signup' && (
              <Button onClick={() => resetMode('code-login')} size="inline" type="button" variant="textStrong">
                Sign in with code
              </Button>
            )}
            {mode === 'code-login' && (
              <p>
                Prefer a password?{' '}
                <Button onClick={() => resetMode('password-login')} size="inline" type="button" variant="textStrong">
                  Sign in with password
                </Button>
              </p>
            )}
            {mode === 'password-login' && (
              <p>
                Forgot password?{' '}
                <Button onClick={() => resetMode('forgot-password')} size="inline" type="button" variant="textStrong">
                  Reset it
                </Button>
              </p>
            )}
            {mode !== 'signup' ? (
              <p>
                New to Verxio?{' '}
                <Button onClick={() => resetMode('signup')} size="inline" type="button" variant="textStrong">
                  Create account
                </Button>
              </p>
            ) : (
              <p>
                Already have a workspace?{' '}
                <Button onClick={() => resetMode('code-login')} size="inline" type="button" variant="textStrong">
                  Sign in
                </Button>
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

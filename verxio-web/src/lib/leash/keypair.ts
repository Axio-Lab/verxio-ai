import * as ed from '@noble/ed25519'
import bs58 from 'bs58'

import type { LeashNetwork } from './types'

const SOLANA_SECRET_KEY_LENGTH = 64

export function executiveSecretToBase58(privateKey: Uint8Array, publicKey: Uint8Array): string {
  const secretKey = new Uint8Array(SOLANA_SECRET_KEY_LENGTH)
  secretKey.set(privateKey, 0)
  secretKey.set(publicKey, 32)

  return bs58.encode(secretKey)
}

export async function generateExecutiveKeypairBase58(): Promise<string> {
  const privateKey = ed.utils.randomSecretKey()
  const publicKey = ed.getPublicKey(privateKey)

  return executiveSecretToBase58(privateKey, publicKey)
}

export function importExecutiveKeypairBase58(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Private key is required.')
  }

  let decoded: Uint8Array

  try {
    decoded = bs58.decode(trimmed)
  } catch {
    throw new Error('Private key must be base58-encoded.')
  }

  if (decoded.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new Error('Private key must decode to 64 bytes (Solana executive secret).')
  }

  return trimmed
}

export function executivePublicKeyBase58(executiveKeypairBase58: string): string {
  const secretKey = bs58.decode(executiveKeypairBase58)

  if (secretKey.length !== SOLANA_SECRET_KEY_LENGTH) {
    throw new Error('Invalid executive keypair length.')
  }

  return bs58.encode(secretKey.slice(32, 64))
}

export function normalizeLeashNetwork(
  value: string | undefined,
  fallback: LeashNetwork = 'solana-devnet'
): LeashNetwork {
  return value === 'solana-mainnet' ? 'solana-mainnet' : fallback
}

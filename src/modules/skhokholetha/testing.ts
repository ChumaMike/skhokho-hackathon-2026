/**
 * Test-only helpers (imported by *.test.ts files only). Switch Skhokholetha on
 * with a throwaway legal configuration — example.test URLs and test versions,
 * not legal documents — and give a restore function so no test leaks env.
 */

export const TEST_LEGAL_ENV = {
  DRIVER_TERMS_VERSION: 'test-terms-1',
  DRIVER_TERMS_URL: 'https://example.test/driver-terms',
  DRIVER_PRIVACY_VERSION: 'test-privacy-1',
  DRIVER_PRIVACY_URL: 'https://example.test/driver-privacy',
} as const

export const ALL_FLAGS_ON = {
  SKHOKHOLETHA_ENABLED: 'true',
  DRIVER_SIGNUP_ENABLED: 'true',
  DELIVERY_REQUESTS_ENABLED: 'true',
  DRIVER_APPROVALS_ENABLED: 'true',
} as const

/** Sets env vars (undefined deletes) and returns a function that puts them back. */
export function setEnv(vars: Record<string, string | undefined>): () => void {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

export function enableLethaForTests(): () => void {
  return setEnv({ ...ALL_FLAGS_ON, ...TEST_LEGAL_ENV })
}

/** Profile fields for a driver who accepted the test legal versions. */
export function LEGAL_FIELDS_ACCEPTED() {
  const now = new Date()
  return {
    agreementVersion: TEST_LEGAL_ENV.DRIVER_TERMS_VERSION,
    agreementAcceptedAt: now,
    privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION,
    privacyAcceptedAt: now,
  }
}

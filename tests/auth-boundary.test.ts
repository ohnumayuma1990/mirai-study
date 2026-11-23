import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertOwnedImagePath,
  assertOwnedStagingPath,
} from '../server/utils/image-validation'

describe('Auth & multi-layer storage boundary enforcement', () => {
  it('allows only strictly owned users/{uid}/{ingestType}/{uuid}.{ext} paths', () => {
    const uid = 'uid-owner-123'
    const validPath = `users/${uid}/exam_result_ocr/123e4567-e89b-12d3-a456-426614174000.jpg`
    expect(assertOwnedImagePath(uid, validPath)).toEqual({
      ingestType: 'exam_result_ocr',
      fileName: '123e4567-e89b-12d3-a456-426614174000.jpg',
    })

    // Cross-user access
    expect(() =>
      assertOwnedImagePath(uid, 'users/other-user/exam_result_ocr/123e4567-e89b-12d3-a456-426614174000.jpg'),
    ).toThrowError()

    // Path traversal
    expect(() =>
      assertOwnedImagePath(uid, `users/${uid}/../other/123e4567-e89b-12d3-a456-426614174000.jpg`),
    ).toThrowError()

    // Invalid ingestType
    expect(() =>
      assertOwnedImagePath(uid, `users/${uid}/unknown_bucket/123e4567-e89b-12d3-a456-426614174000.jpg`),
    ).toThrowError()
  })

  it('allows only strictly owned staging/{uid}/{uuid}.{ext} paths', () => {
    const uid = 'uid-owner-123'
    expect(
      assertOwnedStagingPath(uid, `staging/${uid}/123e4567-e89b-12d3-a456-426614174000.png`),
    ).toEqual({
      fileName: '123e4567-e89b-12d3-a456-426614174000.png',
    })

    expect(() =>
      assertOwnedStagingPath(uid, 'staging/other/123e4567-e89b-12d3-a456-426614174000.png'),
    ).toThrowError()
  })

  it('denies all direct client access in firestore.rules and storage.rules', () => {
    const root = resolve(__dirname, '..')
    const firestoreRules = readFileSync(resolve(root, 'firestore.rules'), 'utf8')
    const storageRules = readFileSync(resolve(root, 'storage.rules'), 'utf8')

    expect(firestoreRules).toContain('allow read, write: if false;')
    expect(storageRules).toContain('allow read, write: if false;')
  })
})

import { createError, readRawBody, type H3Event } from 'h3'
import { A2aJsonRpcRequestSchema, type A2aJsonRpcRequest } from '../../shared/schemas/a2a'

export const MAX_A2A_BODY_BYTES = 6 * 1024 * 1024 // 6MB (allows base64 encoded 4MB image)

export async function readAndValidateA2aBody(event: H3Event): Promise<A2aJsonRpcRequest> {
  const raw = await readRawBody(event, 'utf8')
  if (!raw || raw.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Empty JSON-RPC request body.',
    })
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_A2A_BODY_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large: A2A request body exceeds size limit.',
    })
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Malformed JSON body.',
    })
  }

  const validated = A2aJsonRpcRequestSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request: Invalid A2A JSON-RPC payload.',
    })
  }

  return validated.data
}

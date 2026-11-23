import { defineEventHandler } from 'h3'
import { MAX_STUDY_TRACKS, type TracksListResponse } from '../../shared/schemas/track'
import { requireAuthUser } from '../utils/auth'
import { listStudyTracks } from '../domain/miraistudy-service'

export default defineEventHandler(async (event): Promise<TracksListResponse> => {
  const user = await requireAuthUser(event)
  const tracks = await listStudyTracks(user.uid)
  return {
    tracks,
    maxTracks: MAX_STUDY_TRACKS,
  }
})

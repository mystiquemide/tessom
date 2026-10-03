import {createClient} from '@sanity/client'

import {photos} from './photo-manifest'
import {remnants} from './seed-data'

const IMAGE_WIDTH = 2400

async function unsplash(path: string, key: string): Promise<Response> {
  const response = await fetch(`https://api.unsplash.com${path}`, {headers: {Authorization: `Client-ID ${key}`}})
  if (!response.ok) throw new Error(`Unsplash ${path} returned ${response.status}`)
  return response
}

async function main(): Promise<void> {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim()
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'
  const token = process.env.SANITY_API_WRITE_TOKEN?.trim()
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim()
  if (!projectId || !token || !key) throw new Error('Set NEXT_PUBLIC_SANITY_PROJECT_ID, SANITY_API_WRITE_TOKEN and UNSPLASH_ACCESS_KEY.')

  const client = createClient({projectId, dataset, token, apiVersion: '2026-10-01', useCdn: false})

  for (const remnant of remnants) {
    const current = await client.fetch<{title?: string} | null>(`*[_id == $id][0]{title}`, {id: remnant.id})
    if (current && current.title !== remnant.title) {
      await client.patch(remnant.id).set({title: remnant.title, 'fabric.name': remnant.fabric.name}).commit()
      console.log(`${remnant.id}: renamed to ${remnant.title}`)
    }
  }

  for (const entry of photos) {
    const existing = await client.fetch<{image?: unknown; photo?: unknown} | null>(`*[_id == $id][0]{photo, image}`, {id: entry.docId})
    if (!existing) throw new Error(`Document ${entry.docId} not found`)
    const field = entry.docId.startsWith('template') ? 'image' : 'photo'
    if (existing[field]) {
      console.log(`${entry.docId}: already has ${field}, skipped`)
      continue
    }

    const file = await fetch(`${entry.rawUrl}&w=${IMAGE_WIDTH}&q=85&fm=jpg`)
    if (!file.ok) throw new Error(`Image download for ${entry.unsplashId} returned ${file.status}`)
    const buffer = Buffer.from(await file.arrayBuffer())

    const asset = await client.assets.upload('image', buffer, {
      filename: `unsplash-${entry.unsplashId}.jpg`,
      contentType: 'image/jpeg',
      creditLine: `Photo by ${entry.photographer} on Unsplash`,
      source: {name: 'unsplash', id: entry.unsplashId, url: entry.pageUrl},
    })
    await client.patch(entry.docId).set({[field]: {_type: 'image', asset: {_type: 'reference', _ref: asset._id}}}).commit()
    await unsplash(`/photos/${entry.unsplashId}/download`, key)
    console.log(`${entry.docId}: ${field} set from ${entry.unsplashId}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Photo attach failed.')
  process.exitCode = 1
})

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { writePluginFileAtomically } from '../plugins/plugin-atomic-file-write'
import { SbxName } from '../../shared/sbx-types'

const BindingSchema = z.object({
  name: SbxName,
  sandboxId: z.string().min(1),
  agent: z.string(),
  workspace: z.string(),
  paneIdentity: z.string(),
  connectionId: z.string().nullable()
})
export type SbxBinding = z.infer<typeof BindingSchema>

function bindingPath(name: string, connectionId?: string | null): string {
  const key = createHash('sha256')
    .update(`${connectionId ?? 'local'}:${name}`)
    .digest('hex')
  return join(getProfileUserDataPath(), 'sbx-bindings', `${key}.json`)
}

export async function readSbxBinding(
  name: string,
  connectionId?: string | null
): Promise<SbxBinding | null> {
  try {
    return BindingSchema.parse(JSON.parse(await readFile(bindingPath(name, connectionId), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function saveSbxBinding(binding: SbxBinding): Promise<void> {
  const value = BindingSchema.parse(binding)
  await mkdir(join(getProfileUserDataPath(), 'sbx-bindings'), { recursive: true })
  await writePluginFileAtomically(
    bindingPath(value.name, value.connectionId),
    JSON.stringify(value),
    { mode: 0o600 }
  )
}

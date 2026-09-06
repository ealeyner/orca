import { z } from 'zod'

export const SBX_AGENTS = [
  'claude',
  'claude-bedrock',
  'codex',
  'copilot',
  'cursor',
  'docker-agent',
  'droid',
  'gemini',
  'kiro',
  'opencode',
  'shell'
] as const
export const SbxName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/)
const text = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\0\r\n]/.test(s))
export const SbxLaunchPolicySchema = z.object({
  enabled: z.boolean().default(true),
  profile: text.optional(),
  template: text.optional(),
  cpus: z.number().int().min(1).max(256).optional(),
  memory: z
    .string()
    .regex(/^\d+[mMgG]$/)
    .optional(),
  workspaces: z
    .array(z.object({ path: text, readOnly: z.boolean() }))
    .max(32)
    .default([]),
  denyNetwork: z.array(text).max(128).default([]),
  staticMcp: z.array(SbxName).max(64).default([])
})
export type SbxLaunchPolicy = z.infer<typeof SbxLaunchPolicySchema>
export type SbxSettings = { enabled: boolean; agents?: Record<string, SbxLaunchPolicy> }
export type SbxSandbox = {
  managed?: boolean
  name: string
  id: string
  agent: string
  status: string
  workspaces: string[]
}
export const SbxInventorySchema = z.object({
  sandboxes: z.array(
    z.object({
      name: SbxName,
      id: z.string(),
      agent: z.string(),
      status: z.string(),
      workspaces: z.array(z.string()).default([])
    })
  )
})
export const SbxCreateSchema = SbxLaunchPolicySchema.extend({
  name: SbxName,
  agent: z.enum(SBX_AGENTS),
  workspace: text
})
export type SbxCreate = z.infer<typeof SbxCreateSchema>
export const DEFAULT_SBX_POLICY: SbxLaunchPolicy = {
  enabled: true,
  workspaces: [],
  denyNetwork: [],
  staticMcp: []
}

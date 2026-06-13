import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0]
type ToolParameters = RegisteredTool['parameters']

export function toolParameters(schema: TSchema): ToolParameters {
  return schema as ToolParameters
}

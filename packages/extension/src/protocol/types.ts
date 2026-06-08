export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }
export type JSONObject = { [key: string]: JSONValue }
export type ToolArgs = Record<string, unknown>

export interface ToolResult {
  text: string
  isError: boolean
}

export interface PendingToolCall {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
}

export interface BridgeInfo {
  project?: string
  transport?: string
  integrations?: string[]
  skills?: BridgeSkillInfo[]
  plugins?: BridgePluginInfo[]
  endpoints?: BridgeEndpoint[]
  apis?: BridgeAPIInventory
}

export interface BridgeSkillInfo {
  name?: string
  path?: string
  module?: string
  metadata?: ToolArgs
  markdown?: string
  apis?: BridgeAPIExtension[]
}

export interface BridgePluginInfo {
  name?: string
  module?: string
}

export interface BridgeEndpoint {
  module?: string
  url?: string | null
  port?: number | null
}

export interface BridgeAPIInventory {
  runtime?: BridgeAPIModule[]
  extensions?: BridgeAPIExtension[]
}

export interface BridgeAPIModule {
  name?: string
  module?: string
  functions?: BridgeAPIFunction[]
}

export interface BridgeAPIFunction {
  name?: string
  arity?: number
}

export interface BridgeAPIExtension {
  name?: string
  module?: string
  alias?: string | null
  description?: string
  examples?: string[]
}

export interface BridgeUIEvent {
  type: 'ui'
  op?: string
  key?: string
  text?: string
  title?: string
  current?: number
  total?: number
  lines?: string[]
  placement?: 'aboveEditor' | 'belowEditor'
  message?: string
  level?: 'info' | 'warning' | 'error'
}

export interface BridgeEvent extends ToolArgs {
  type: string
  cwd?: string
  turnIndex?: number
}

export interface LLMMessagePayload {
  content?: string
  role?: string
}

export interface BridgeRequestPayload extends ToolArgs {
  messages?: LLMMessagePayload[]
}

export interface StdioMessage {
  type?: string
  id?: number | string
  text?: string
  isError?: boolean
  info?: BridgeInfo
  op?: string
  key?: string
  title?: string
  current?: number
  total?: number
  lines?: string[]
  placement?: 'aboveEditor' | 'belowEditor'
  message?: string
  level?: 'info' | 'warning' | 'error'
  payload?: BridgeRequestPayload
}

export interface McpContent {
  type: string
  text: string
}

export interface McpResult {
  content?: McpContent[]
  isError?: boolean
}

export interface McpError {
  code: number
  message: string
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: McpResult
  error?: McpError
}

export interface McpConfig {
  project_name: string
  framework_type: string
}

export interface ConnectionTarget {
  url: string
  kind: string | null
}

import { Type } from 'typebox'
import { Check } from 'typebox/value'

import type { StdioMessage } from './types.ts'

const openObject = { additionalProperties: true } as const
const bridgeInfoSchema = Type.Object(
  {
    project: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    version: Type.Optional(Type.String()),
    build: Type.Optional(Type.String()),
    protocol: Type.Optional(Type.Number()),
    transport: Type.Optional(Type.String()),
    capabilities: Type.Optional(Type.Array(Type.String())),
    skills: Type.Optional(Type.Array(Type.Object({}, openObject))),
    plugins: Type.Optional(Type.Array(Type.Object({}, openObject))),
    commands: Type.Optional(Type.Array(Type.Object({}, openObject))),
    apis: Type.Optional(Type.Object({}, openObject))
  },
  openObject
)

const readySchema = Type.Object(
  {
    type: Type.Literal('ready'),
    info: bridgeInfoSchema
  },
  openObject
)

const resultSchema = Type.Object(
  {
    type: Type.Literal('result'),
    id: Type.Number(),
    text: Type.String(),
    isError: Type.Boolean()
  },
  openObject
)

const requestSchema = Type.Object(
  {
    type: Type.Literal('request'),
    id: Type.String(),
    op: Type.String(),
    payload: Type.Optional(Type.Object({}, openObject))
  },
  openObject
)

const uiSchema = Type.Object(
  {
    type: Type.Literal('ui'),
    op: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    current: Type.Optional(Type.Number()),
    total: Type.Optional(Type.Number()),
    lines: Type.Optional(Type.Array(Type.String())),
    placement: Type.Optional(
      Type.Union([Type.Literal('aboveEditor'), Type.Literal('belowEditor')])
    ),
    message: Type.Optional(Type.String()),
    level: Type.Optional(
      Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')])
    )
  },
  openObject
)

const eventSchema = Type.Object(
  {
    type: Type.Literal('event'),
    name: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown())
  },
  openObject
)

const stdioMessageSchema = Type.Union([
  readySchema,
  resultSchema,
  requestSchema,
  uiSchema,
  eventSchema
])

export function decodeStdioMessage(value: unknown): StdioMessage | null {
  return Check(stdioMessageSchema, value) ? (value as StdioMessage) : null
}

import { prisma } from './client'
import type { Prisma } from '@prisma/client'

export type EventActor = 'user' | 'system' | 'scheduler' | 'coach'

export interface WriteEventInput {
  actor: EventActor
  entityType: string
  entityId: string
  action: string
  payload?: Prisma.InputJsonValue
}

export async function writeEvent(input: WriteEventInput) {
  return prisma.event.create({
    data: {
      actor: input.actor,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: input.payload ?? {},
    },
  })
}

export interface ReadEventsFilter {
  entityType?: string
  entityId?: string
  action?: string
  since?: Date
  limit?: number
}

export async function readEvents(filter: ReadEventsFilter = {}) {
  return prisma.event.findMany({
    where: {
      entityType: filter.entityType,
      entityId: filter.entityId,
      action: filter.action,
      timestamp: filter.since ? { gte: filter.since } : undefined,
    },
    orderBy: { timestamp: 'desc' },
    take: filter.limit ?? 50,
  })
}

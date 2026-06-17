import { z } from 'zod'
import { router, publicProcedure } from '@/server/trpc'
import { prisma } from '@/server/db/client'
import { writeEvent } from '@/server/db/events'

/**
 * folder router — hierarchical folder tree for grouping Ideas (Obsidian-style).
 *
 * A Folder can nest arbitrarily via the self-referencing "FolderTree" relation.
 * All mutations write an Event row (project convention — non-negotiable).
 * Archiving a folder soft-deletes it and un-files its direct ideas (folderId → null).
 */

// ── Type for the recursive nested tree returned by `tree` ───────────────────
export interface FolderNode {
  id: string
  name: string
  parentId: string | null
  position: number
  children: FolderNode[]
}

function buildTree(
  folders: { id: string; name: string; parentId: string | null; position: number }[],
  parentId: string | null = null,
): FolderNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      ...f,
      children: buildTree(folders, f.id),
    }))
}

export const folderRouter = router({
  // Nested folder tree — active (non-archived) folders only, ordered by position.
  tree: publicProcedure.query(async (): Promise<FolderNode[]> => {
    const folders = await prisma.folder.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, parentId: true, position: true },
    })
    return buildTree(folders)
  }),

  // Create a new folder — optionally nested under a parent.
  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      parentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Append after existing siblings (position = max + 1).
      const lastSibling = await prisma.folder.findFirst({
        where: { parentId: input.parentId ?? null, archivedAt: null },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const folder = await prisma.folder.create({
        data: {
          name: input.name.trim(),
          parentId: input.parentId ?? null,
          position: (lastSibling?.position ?? -1) + 1,
        },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'folder',
        entityId: folder.id,
        action: 'create',
        payload: { name: folder.name, parentId: folder.parentId ?? null },
      })
      return folder
    }),

  // Rename a folder.
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const folder = await prisma.folder.update({
        where: { id: input.id },
        data: { name: input.name.trim() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'folder',
        entityId: folder.id,
        action: 'rename',
        payload: { name: folder.name },
      })
      return folder
    }),

  // Reparent a folder (null = move to root).
  move: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string().nullable() }))
    .mutation(async ({ input }) => {
      const folder = await prisma.folder.update({
        where: { id: input.id },
        data: { parentId: input.parentId },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'folder',
        entityId: folder.id,
        action: 'move',
        payload: { parentId: input.parentId },
      })
      return folder
    }),

  // Soft-delete a folder and un-file its direct ideas (folderId → null).
  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Un-file direct ideas first so they surface in Unfiled.
      await prisma.idea.updateMany({
        where: { folderId: input.id },
        data: { folderId: null },
      })
      const folder = await prisma.folder.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      })
      await writeEvent({
        actor: 'user',
        entityType: 'folder',
        entityId: folder.id,
        action: 'archive',
        payload: { name: folder.name },
      })
      return folder
    }),
})

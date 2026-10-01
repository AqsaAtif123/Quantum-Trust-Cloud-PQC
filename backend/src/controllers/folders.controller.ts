import { Request, Response } from 'express';
import { z } from 'zod';
import { Folder } from '../models/Folder';

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
});

export async function createFolder(req: Request, res: Response): Promise<void> {
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  if (parsed.data.parentId) {
    const parent = await Folder.findOne({ _id: parsed.data.parentId, ownerId: req.ztx!.userId, isTrashed: false });
    if (!parent) {
      res.status(404).json({ error: 'PARENT_FOLDER_NOT_FOUND' });
      return;
    }
  }

  const folder = await Folder.create({
    ownerId: req.ztx!.userId,
    parentId: parsed.data.parentId ?? null,
    name: parsed.data.name,
  });

  res.status(201).json({ folder });
}

export async function listFolders(req: Request, res: Response): Promise<void> {
  const parentId = (req.query.parentId as string) || null;
  const folders = await Folder.find({
    ownerId: req.ztx!.userId,
    parentId,
    isTrashed: false,
  }).sort({ name: 1 });
  res.json({ folders });
}

/** Returns the chain of ancestor folders from root to the given folder, for breadcrumb navigation. */
export async function getFolderPath(req: Request, res: Response): Promise<void> {
  const path: Array<{ id: string; name: string }> = [];
  let currentId: string | null = req.params.id;

  while (currentId) {
    const folder: InstanceType<typeof Folder> | null = await Folder.findOne({
      _id: currentId,
      ownerId: req.ztx!.userId,
    });
    if (!folder) break;
    path.unshift({ id: folder._id.toString(), name: folder.name });
    currentId = folder.parentId ? folder.parentId.toString() : null;
  }

  res.json({ path });
}

const renameFolderSchema = z.object({ name: z.string().min(1).max(255) });

export async function renameFolder(req: Request, res: Response): Promise<void> {
  const parsed = renameFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const folder = await Folder.findOneAndUpdate(
    { _id: req.params.id, ownerId: req.ztx!.userId },
    { name: parsed.data.name },
    { new: true },
  );
  if (!folder) {
    res.status(404).json({ error: 'FOLDER_NOT_FOUND' });
    return;
  }
  res.json({ folder });
}

export async function trashFolder(req: Request, res: Response): Promise<void> {
  const folder = await Folder.findOneAndUpdate(
    { _id: req.params.id, ownerId: req.ztx!.userId },
    { isTrashed: true },
    { new: true },
  );
  if (!folder) {
    res.status(404).json({ error: 'FOLDER_NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
}

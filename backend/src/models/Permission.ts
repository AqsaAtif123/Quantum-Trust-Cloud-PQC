import { Schema, model, Document, Types } from 'mongoose';

export type ResourceType = 'file' | 'folder' | 'room';
export type PermissionRole = 'viewer' | 'contributor' | 'editor' | 'admin' | 'owner';

export interface IPermission extends Document {
  _id: Types.ObjectId;
  resourceType: ResourceType;
  resourceId: Types.ObjectId;
  granteeUserId: Types.ObjectId;
  role: PermissionRole;
  grantedByUserId: Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
}

const permissionSchema = new Schema<IPermission>(
  {
    resourceType: { type: String, enum: ['file', 'folder', 'room'], required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    granteeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['viewer', 'contributor', 'editor', 'admin', 'owner'], required: true },
    grantedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

permissionSchema.index({ resourceType: 1, resourceId: 1, granteeUserId: 1 }, { unique: true });

export const Permission = model<IPermission>('Permission', permissionSchema);

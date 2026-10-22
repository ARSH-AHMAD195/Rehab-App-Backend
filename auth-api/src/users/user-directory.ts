import { FilterQuery, Model, Types } from 'mongoose';
import { DEFAULT_PAGE_LIMIT, Role } from '../common/constants';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { User, UserDocument } from './user.schema';

export interface DirectoryQuery {
  q?: string;
  active?: 'true' | 'false' | 'all';
  limit?: number;
  cursor?: string;
}

/**
 * One page of users of a role, sorted by name (v1.0 GET /patients, GET
 * /doctors). Keyset pagination on (name, _id), so pages stay stable while new
 * users are registered.
 */
export async function listUsers(
  model: Model<User>,
  role: Role,
  query: DirectoryQuery,
  extra: FilterQuery<User> = {},
): Promise<{ rows: UserDocument[]; nextCursor: string | null }> {
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const filter: FilterQuery<User> = { ...extra, role };

  const active = query.active ?? 'true';
  if (active !== 'all') filter.active = active === 'true';

  const and: FilterQuery<User>[] = [];
  if (query.q) {
    const pattern = new RegExp(escapeRegExp(query.q), 'i');
    and.push({ $or: [{ name: pattern }, { email: pattern }] });
  }
  if (query.cursor) {
    const { k, id } = decodeCursor(query.cursor);
    and.push({ $or: [{ name: { $gt: k } }, { name: k, _id: { $gt: new Types.ObjectId(id) } }] });
  }
  if (and.length) filter.$and = and;

  const rows = await model.find(filter).sort({ name: 1, _id: 1 }).limit(limit + 1).exec();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.name, id: String(last._id) }) : null,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import 'server-only'
import { type ClienteDb, db } from '@/server/db'


export function clienteSemIsolamento(): ClienteDb {
  return db()
}

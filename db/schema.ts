import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('lesson_rooms', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  teacherId: text('teacher_id'),
  invitationHash: text('invitation_hash').notNull(),
  packet: text('packet').notNull(),
  snapshot: text('snapshot').notNull(),
  revision: integer('revision').notNull().default(0),
  lastOp: text('last_op').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  closed: integer('closed').notNull().default(0),
}, table => [index('rooms_learner').on(table.learnerId), index('rooms_teacher').on(table.teacherId)]);

export const operations = sqliteTable('lesson_operations', {
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  operationId: text('operation_id').notNull(),
  revision: integer('revision').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.roomId, table.operationId] })]);

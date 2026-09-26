import { hash } from '@node-rs/argon2';
import { Role } from '../src/generated/prisma/client.js';
import { prisma, runAsScript } from './seed-client.js';
import { seedHierarchy } from './seed-hierarchy.js';
import { seedTemplates } from './seed-templates.js';

/**
 * The whole seed: the super admin, the hierarchy, the document templates.
 *
 * One command, because a fresh clone that comes up with an empty Jenis Node
 * and an empty Hierarki cannot create a project — so the master data is not
 * optional extra content, it is what makes the app usable at all. Each step is
 * still its own module and its own script, for re-running one of them.
 *
 * Every step is idempotent and **none of them overwrites**: a row whose code or
 * email already exists is left as it is. Re-running the seed on a database
 * somebody has been working in fills in what is missing and touches nothing
 * else. The one exception is the admin password, which is refreshed on purpose
 * so a forgotten development password is recoverable.
 *
 * One account and no sample users, so a fresh database has the smallest
 * possible attack surface and every other user is created deliberately through
 * the app - where it is validated, role-checked and recorded in the audit trail.
 *
 * Development gets a known default password so `npm run db:seed` works with no
 * setup. Production does not: there, both SEED_ADMIN_EMAIL and
 * SEED_ADMIN_PASSWORD must be supplied, because a default admin password that
 * ships with the repository is the most reliable way to lose a live system.
 *
 * The seed never deletes anything. Removing an account is a decision for a
 * person, through the app, not a side effect of running a script.
 */
const DEFAULT_ADMIN_EMAIL = 'admin@dtrace.local';
const DEFAULT_PASSWORD = 'password1234';
/** SUPER_ADMIN is the highest rank in ROLE_RANK: the platform operator. */
const SUPER_ADMIN_NAME = 'Super Admin';

/** Kept in step with PasswordService; `Algorithm.Argon2id` inlined as 2. */
const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

async function seedAdmin(): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const email = process.env['SEED_ADMIN_EMAIL'] ?? (isProduction ? null : DEFAULT_ADMIN_EMAIL);
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? (isProduction ? null : DEFAULT_PASSWORD);

  if (!email || !password) {
    throw new Error(
      'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before seeding in production (see .env.example).',
    );
  }

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const usingDefault = password === DEFAULT_PASSWORD;
  if (usingDefault && isProduction) {
    // Belt and braces: even if the default leaked into the environment.
    throw new Error('Refusing to seed the built-in development password in production.');
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  // Idempotent: re-running refreshes the password but never demotes or
  // duplicates an existing administrator.
  const admin = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      name: SUPER_ADMIN_NAME,
      passwordHash,
      role: Role.SUPER_ADMIN,
      isActive: true,
      passwordChangedAt: new Date(),
    },
    create: {
      email: email.toLowerCase(),
      name: SUPER_ADMIN_NAME,
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`Seeded ${SUPER_ADMIN_NAME}: ${admin.email} (role ${admin.role})`);
  console.log(
    usingDefault
      ? `Password: ${DEFAULT_PASSWORD} (development default)`
      : 'Password: the value of SEED_ADMIN_PASSWORD',
  );

  const others = await prisma.user.count({ where: { email: { not: email.toLowerCase() } } });
  if (others > 0) {
    // Said plainly rather than acted on: the seed is not allowed to delete.
    console.log(`Note: ${others} other account(s) already exist and were left untouched.`);
  }
}




/**
 * Account first, then the tree, then the templates.
 *
 * The order is not arbitrary: node types have to exist before the nodes that
 * stand on them, and a template's blank documents are linked to projects that
 * only a placed node can carry. Running it the other way round would work on
 * an empty database and fail on a half-filled one.
 */
async function main(): Promise<void> {
  await seedAdmin();

  console.log('\n— Hierarki —');
  await seedHierarchy();

  console.log('\n— Master dokumen —');
  await seedTemplates();
}

runAsScript(main);

# Database Migrations Guide

This document explains the database migration strategy for the Mobvibe Gateway.

## Overview

The gateway uses **Drizzle ORM** with **PostgreSQL** for data persistence. We follow a migration-based approach for managing database schema changes in production.

## Migration Strategy

### Development vs Production

| Environment | Tool | Use Case |
|-------------|------|----------|
| **Development** | `drizzle-kit push` | Quick prototyping, schema changes without version control |
| **Production** | `drizzle-kit migrate` | Versioned migrations, safe and trackable schema changes |

### Why Not `push` in Production?

- `drizzle-kit push` directly applies schema changes without creating migration files
- No rollback capability
- No audit trail of schema changes
- Dangerous with `--force` flag (can cause data loss)
- Not suitable for team collaboration or CI/CD pipelines

### Why `migrate` in Production?

- Creates versioned SQL migration files
- Migration files are committed to version control
- Provides audit trail of all schema changes
- Supports rollback (with custom logic if needed)
- Safe for team collaboration and production deployments

## Migration Workflow

### 1. Making Schema Changes (Development)

When you modify the database schema in `src/db/schema.ts`:

```bash
# Generate migration files from schema changes
pnpm db:generate

# Review the generated SQL in drizzle/ directory
# If satisfied, apply the migration locally
pnpm db:migrate
```

This creates a new migration file in `apps/gateway/drizzle/XXXX_description.sql`.

**Important**: Always commit the generated migration files to version control!

```bash
git add drizzle/
git commit -m "feat: add new table for feature X"
```

### 2. Applying Migrations (Production)

Migrations are **automatically applied at deployment time**, not during build:

#### Docker/Railway Deployment

The `Dockerfile` includes a startup script that:
1. Checks if `DATABASE_URL` is set
2. Runs `drizzle-kit migrate` before starting the server
3. Applies all pending migrations in order

```dockerfile
# Startup script (in Dockerfile)
npx drizzle-kit migrate  # Apply pending migrations
node dist/index.js       # Start the server
```

#### Why Run Migrations at Deployment (Not Build)?

✅ **Deploy Time (Recommended)**
- Database URL is available (production environment variable)
- Ensures migrations run just before the app starts
- Safe for zero-downtime deployments
- Failed migrations prevent the app from starting with mismatched schema

❌ **Build Time (Not Recommended)**
- Database URL might not be available during Docker build
- Build artifacts should be environment-agnostic
- Multiple deployments from same build would attempt migrations multiple times
- Harder to troubleshoot migration failures

### 3. Migration Files Structure

```
apps/gateway/drizzle/
├── 0000_initial_schema.sql       # Initial migration
├── 0001_add_machines_table.sql   # Second migration
├── 0002_add_sessions_indexes.sql # Third migration
└── meta/
    ├── 0000_snapshot.json         # Schema snapshots
    ├── 0001_snapshot.json
    └── _journal.json              # Migration journal
```

### 4. Local Development Options

For rapid local development, you can still use `push`:

```bash
# Quick schema sync (development only)
pnpm db:push

# Open Drizzle Studio to browse data
pnpm db:studio
```

**Warning**: Never use `push` in production or Railway deployments!

## Railway Deployment

### Environment Variables

Ensure these are set in Railway:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}  # Reference to PostgreSQL service
```

### Deployment Flow

1. Push code to GitHub (including migration files in `drizzle/`)
2. Railway triggers a new deployment
3. Docker build completes
4. Container starts and runs `/app/start.sh`:
   - Executes `drizzle-kit migrate` (applies pending migrations)
   - Starts Express server
5. Health check passes at `/health`

### Monitoring Migrations

View migration logs in Railway:

```bash
railway logs --service gateway
```

Look for:
```
[gateway] Running database migrations...
[gateway] Migrations complete
```

## Common Tasks

### Add a New Table

1. Edit `src/db/schema.ts`:
```typescript
export const newTable = pgTable("new_table", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // ...
});
```

2. Generate migration:
```bash
pnpm db:generate
```

3. Review generated SQL in `drizzle/XXXX_*.sql`

4. Test locally:
```bash
pnpm db:migrate
```

5. Commit and push:
```bash
git add drizzle/ src/db/schema.ts
git commit -m "feat: add new_table for feature X"
git push
```

6. Railway auto-deploys and runs migration

### Modify an Existing Table

Same as adding a new table. Drizzle will generate ALTER statements.

**Important**: Some changes may require manual migration editing:
- Renaming columns (appears as DROP + ADD without manual edit)
- Complex data transformations
- Ensuring zero-downtime for live production

Always review generated SQL before committing!

### Rollback a Migration

Drizzle Kit doesn't have built-in rollback. To rollback:

1. **Manual approach**: Write a new migration that reverses the changes
2. **Database restore**: Restore from a backup (if available)

**Prevention is better**: Always test migrations locally before deploying!

## Best Practices

1. ✅ **Always generate migrations for schema changes**
   ```bash
   pnpm db:generate
   ```

2. ✅ **Commit migration files to version control**
   ```bash
   git add drizzle/
   ```

3. ✅ **Review generated SQL before committing**
   - Check for data loss risks
   - Verify indexes are created correctly
   - Ensure foreign keys are handled properly

4. ✅ **Test migrations locally before deploying**
   ```bash
   pnpm db:migrate
   ```

5. ✅ **Use `migrate` in production, not `push`**
   - Production: `drizzle-kit migrate`
   - Development: `drizzle-kit push` (optional)

6. ✅ **Run migrations at deploy time, not build time**
   - Ensures database is ready when app starts
   - Fails fast if migration has issues

7. ❌ **Never use `drizzle-kit push --force` in production**
   - Risk of data loss
   - No migration history
   - Not reversible

8. ❌ **Don't modify existing migration files**
   - Once deployed, migration files are immutable
   - Create new migrations to fix issues

## Troubleshooting

### Migration Fails on Railway

1. Check Railway logs for error details
2. Common issues:
   - Syntax error in migration SQL
   - Foreign key constraint violations
   - Duplicate constraint names
   - Missing permissions

3. Fix the issue:
   - For new migrations: Fix schema and regenerate
   - For deployed migrations: Create a new migration to fix

### Schema Drift

If you used `push` accidentally in production:

1. Generate a new migration that matches current state:
   ```bash
   pnpm db:generate
   ```

2. This creates a "catch-up" migration
3. Commit and deploy

### Local Database Out of Sync

```bash
# Reset local database (development only!)
# Drop all tables and re-run all migrations
pnpm db:push  # Quick reset

# OR manually drop/recreate the database
# Then run:
pnpm db:migrate
```

## References

- [Drizzle Kit Documentation](https://orm.drizzle.team/kit-docs/overview)
- [Drizzle Migrations Guide](https://orm.drizzle.team/docs/migrations)
- [Railway PostgreSQL Guide](https://docs.railway.app/databases/postgresql)

## Summary

| Command | When to Use |
|---------|-------------|
| `pnpm db:generate` | After changing `schema.ts` (creates migration files) |
| `pnpm db:migrate` | Apply migrations locally or in production |
| `pnpm db:push` | Quick prototyping in development only |
| `pnpm db:studio` | Browse database with GUI |

**Remember**: In production, migrations happen automatically at deploy time via the Docker startup script!

/**
 * The first schema. IDs are 24 random hex characters, nested settings that are
 * never queried live in JSON columns, and times are epoch milliseconds so no
 * engine converts them by time zone.
 */

const id = (t, name = 'id') => t.string(name, 24);
const times = (t) => {
  t.bigInteger('created_at').notNullable();
  t.bigInteger('updated_at').notNullable();
};

exports.up = async function up(knex) {
  await knex.schema.createTable('admins', (t) => {
    id(t).primary();
    t.string('email', 254).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    times(t);
  });

  await knex.schema.createTable('buckets', (t) => {
    id(t).primary();
    t.string('name', 60).notNullable();
    t.string('provider', 20).notNullable();
    t.string('bucket', 120).notNullable();
    t.string('region', 40).notNullable().defaultTo('');
    t.string('account', 80).notNullable().defaultTo('');
    t.string('endpoint', 255).notNullable().defaultTo('');
    t.string('public_url', 255).notNullable().defaultTo('');
    t.string('access_key', 255).notNullable();
    t.text('secret_enc').notNullable();
    t.boolean('force_path_style').notNullable().defaultTo(false);
    t.boolean('supports_acl').notNullable().defaultTo(true);
    t.boolean('is_default').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('status_ok').nullable();
    t.boolean('status_public_ok').nullable();
    t.bigInteger('status_checked_at').nullable();
    t.text('status_error').nullable();
    times(t);
  });

  await knex.schema.createTable('apps', (t) => {
    id(t).primary();
    t.string('name', 80).notNullable();
    t.string('slug', 40).notNullable().unique();
    t.boolean('active').notNullable().defaultTo(true);
    id(t, 'bucket_id').nullable().index();
    t.string('format', 10).notNullable().defaultTo('webp');
    t.integer('quality').notNullable().defaultTo(80);
    t.boolean('keep_original').notNullable().defaultTo(false);
    t.boolean('allow_documents').notNullable().defaultTo(true);
    t.boolean('allow_archives').notNullable().defaultTo(false);
    t.integer('max_upload_mb').notNullable().defaultTo(15);
    t.json('variants').notNullable();
    t.bigInteger('stats_images').notNullable().defaultTo(0);
    t.bigInteger('stats_bytes_in').notNullable().defaultTo(0);
    t.bigInteger('stats_bytes_out').notNullable().defaultTo(0);
    times(t);
  });

  await knex.schema.createTable('api_keys', (t) => {
    id(t).primary();
    id(t, 'app_id').notNullable().index();
    t.string('label', 60).notNullable().defaultTo('default');
    t.string('prefix', 12).notNullable().unique();
    t.string('hash', 64).notNullable();
    t.string('last4', 4).nullable();
    t.bigInteger('last_used_at').nullable();
    t.bigInteger('revoked_at').nullable();
    times(t);
  });

  await knex.schema.createTable('assets', (t) => {
    id(t).primary();
    id(t, 'app_id').notNullable();
    id(t, 'bucket_id').nullable().index();
    id(t, 'api_key_id').nullable();
    t.string('kind', 16).notNullable().defaultTo('image');
    t.string('folder', 100).notNullable().defaultTo('');
    t.string('hash', 64).notNullable();
    t.string('ref', 120).nullable();
    t.string('original_name', 255).nullable();
    t.string('source', 16).notNullable().defaultTo('upload');
    t.string('input_format', 16).nullable();
    t.integer('input_width').nullable();
    t.integer('input_height').nullable();
    t.bigInteger('input_bytes').nullable();
    t.string('original_key', 512).nullable();
    t.bigInteger('original_bytes').nullable();
    t.json('variants').nullable();
    t.json('file').nullable();
    // Up to ~96 KB; JSON is unbounded on every engine, unlike MySQL's TEXT
    t.json('preview').nullable();
    t.bigInteger('bytes_out').notNullable().defaultTo(0);
    times(t);
    // Dedupe: the same file in the same folder of an app is stored once
    t.unique(['app_id', 'folder', 'hash']);
    t.index(['app_id', 'created_at']);
    t.index(['app_id', 'ref']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  for (const table of ['assets', 'api_keys', 'apps', 'buckets', 'admins']) {
    await knex.schema.dropTableIfExists(table);
  }
};

import { Knex } from 'knex';

const HOUSING_TABLE = 'fast_housing';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(HOUSING_TABLE, (table) => {
    table.string('rs_source').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(HOUSING_TABLE, (table) => {
    table.dropColumn('rs_source');
  });
}

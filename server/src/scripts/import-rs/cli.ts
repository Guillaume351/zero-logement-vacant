import { program } from '@commander-js/extra-typings';

import { createLogger } from '~/infra/logger';
import { createRsCommand } from '~/scripts/import-rs/rs-command';

const logger = createLogger('importRsCli');

program
  .name('import-rs')
  .description('Import RS 2026 housing updates');

program.hook('preAction', (_, actionCommand) => {
  logger.info('Options', actionCommand.opts());
});

program
  .argument('<file>', 'The .jsonl or .jsonl.gz file to import')
  .option('-a, --abort-early', 'Abort the script on the first error')
  .option('-d, --dry-run', 'Run the script without saving to the database')
  .action(async (file, options) => {
    const command = createRsCommand();
    await command(file, options).then(() => {
      process.exit();
    });
  });

function onSignal(): void {
  logger.info('Stopping import...');
  process.exit();
}

process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

export default program;

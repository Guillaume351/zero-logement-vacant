import { flatten, map } from '@zerologementvacant/utils/node';
import { count } from '@zerologementvacant/utils/node';
import { writeFileSync } from 'node:fs';

import UserMissingError from '~/errors/userMissingError';
import config from '~/infra/config';
import { createLogger } from '~/infra/logger';
import userRepository from '~/repositories/userRepository';
import {
  disableHousingsTriggers,
  enableHousingsTriggers,
  ensureKnownHousingsTriggers,
  recomputeHousingsCounts
} from '~/scripts/import-lovac/infra/housings-counts-maintenance';
import { progress } from '~/scripts/import-lovac/infra/progress-bar';
import validator from '~/scripts/import-lovac/infra/validator';
import { createRsEnricher } from '~/scripts/import-rs/rs-enricher';
import { createRsLoader } from '~/scripts/import-rs/rs-loader';
import { createSourceRsFileRepository } from '~/scripts/import-rs/source-rs-file-repository';
import { createRsTransform } from '~/scripts/import-rs/rs-transform';
import { sourceRsSchema } from '~/scripts/import-rs/source-rs';
import { createRsReporter } from '~/scripts/import-rs/rs-reporter';

const logger = createLogger('rsCommand');

export interface ExecOptions {
  abortEarly?: boolean;
  dryRun?: boolean;
}

export function createRsCommand() {
  const reporter = createRsReporter();

  return async (file: string, options: ExecOptions): Promise<void> => {
    try {
      console.time('Import RS 2026');
      logger.debug('Starting RS import...', { file, options });

      const auth = await userRepository.getByEmail(config.app.system);
      if (!auth) {
        throw new UserMissingError(config.app.system);
      }

      await ensureKnownHousingsTriggers();
      const repository = createSourceRsFileRepository(file);
      const total = await count(repository.stream());

      if (!options.dryRun) {
        await disableHousingsTriggers();
      }
      try {
        await repository
          .stream()
          .pipeThrough(progress({ initial: 0, total, name: 'Importing RS 2026' }))
          .pipeThrough(
            validator(sourceRsSchema, {
              abortEarly: options.abortEarly,
              reporter
            })
          )
          .pipeThrough(createRsEnricher())
          .pipeThrough(
            map(
              createRsTransform({
                abortEarly: options.abortEarly,
                adminUserId: auth.id,
                reporter
              })
            )
          )
          .pipeThrough(flatten())
          .pipeTo(createRsLoader({ dryRun: options.dryRun, reporter }));
      } finally {
        if (!options.dryRun) {
          await enableHousingsTriggers();
          await recomputeHousingsCounts();
        }
      }
    } finally {
      reporter.report();
      writeFileSync(
        './import-rs-2026.report.json',
        JSON.stringify(reporter.getSummary(), null, 2),
        'utf8'
      );
      console.timeEnd('Import RS 2026');
    }
  };
}

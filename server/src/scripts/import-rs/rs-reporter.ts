import { createLogger } from '~/infra/logger';
import {
  ImportSummary,
  Reporter,
  ReporterError
} from '~/scripts/import-lovac/infra/reporters/reporter';
import { SourceRs } from '~/scripts/import-rs/source-rs';

const MAX_ERROR_SAMPLES = 10;

interface RsImportSummary extends ImportSummary {
  processed: number;
  failedReasons: Record<string, number>;
  failedSamples: ReadonlyArray<unknown>;
}

function toFailureReason(error: ReporterError): string {
  const message = error.message;
  if (message.startsWith('Housing not found:')) {
    return 'housing_not_found';
  }
  if (message.startsWith('Duplicate source housing:')) {
    return 'duplicate_source_housing';
  }
  return 'invalid_or_unexpected';
}

class RsReporter implements Reporter<SourceRs> {
  private readonly logger = createLogger('rsReporter');
  private readonly startTime = Date.now();
  private pass = 0;
  private skip = 0;
  private fail = 0;
  private create = 0;
  private update = 0;
  private readonly failedReasons = new Map<string, number>();
  private readonly failedSamples: unknown[] = [];

  passed(): void {
    this.pass++;
  }

  skipped(): void {
    this.skip++;
  }

  failed(_data: SourceRs, error: ReporterError): void {
    this.fail++;
    const reason = toFailureReason(error);
    this.failedReasons.set(reason, (this.failedReasons.get(reason) ?? 0) + 1);
    if (this.failedSamples.length < MAX_ERROR_SAMPLES) {
      this.failedSamples.push(error.toJSON());
    }
  }

  created(n: number): void {
    this.create += n;
  }

  updated(n: number): void {
    this.update += n;
  }

  getProgressStats(): Record<string, string | number> {
    return {
      processed: this.pass + this.skip + this.fail,
      toUpdate: this.pass,
      skipped: this.skip,
      failed: this.fail,
      updated: this.update,
      notFound: this.failedReasons.get('housing_not_found') ?? 0,
      duplicate: this.failedReasons.get('duplicate_source_housing') ?? 0,
      durationMs: Date.now() - this.startTime
    };
  }

  getSummary(): RsImportSummary {
    return {
      processed: this.pass + this.skip + this.fail,
      created: this.create,
      updated: this.update,
      skipped: this.skip,
      failed: this.fail,
      durationMs: Date.now() - this.startTime,
      failedReasons: Object.fromEntries(this.failedReasons),
      failedSamples: this.failedSamples
    };
  }

  report(): void {
    this.logger.info('Report', this.getSummary());
  }
}

export function createRsReporter(): RsReporter {
  return new RsReporter();
}
